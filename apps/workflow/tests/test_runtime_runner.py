from __future__ import annotations

import pytest

from storyforge_workflow.runtime.provider_execution import ProviderExecutionResult
from storyforge_workflow.runtime import ModelRunPayload, RuntimeCheckpointStore, WorkflowRuntime
from storyforge_workflow.runtime.checkpoints import ApiModelRunAdapter


class CapturingModelRunSink:
    """测试用 sink，模拟后续 API ModelRun 真表 adapter。"""

    def __init__(self, persisted_model_run_id: int | None = None) -> None:
        self.persisted_model_run_id = persisted_model_run_id
        self.payloads: list[object] = []

    def record(self, payload: object) -> int | None:
        self.payloads.append(payload)
        return self.persisted_model_run_id


def test_workflow_runtime_start_and_resume_records_provider_execution() -> None:
    """运行器可把工作流中断、恢复和 provider 执行摘要记录到检查点仓库。"""

    checkpoint_store = RuntimeCheckpointStore()
    sink = CapturingModelRunSink()
    runtime = WorkflowRuntime(checkpoint_store=checkpoint_store, model_run_sink=sink)

    started = runtime.start(
        thread_id="phase4-runtime-thread",
        job_run_id="phase4-runtime-job",
        premise="远航舰队寻找新家园。",
        user_intent="突出角色强撑与谈判压力。",
        scene_packet={
            "chapter_title": "暗潮",
            "chapter_goal": "舰队抵达灯塔港并争取维修窗口。",
            "scene_goal": "林岚在港口谈判中争取维修窗口。",
            "protagonist": "林岚",
            "required_facts": ["左臂受伤", "灯塔信号每七分钟重复"],
        },
    )

    assert started.status == "interrupted"
    assert started.provider_execution.provider_name == "mock-provider"
    assert started.provider_execution.model_name == "storyforge-writer"
    latest = checkpoint_store.latest("phase4-runtime-thread")
    assert latest is not None
    assert latest.current_node == "draft_writer"
    assert latest.approval_status == "pending"
    checkpoint_state = checkpoint_store.load_state("phase4-runtime-thread")
    model_runs = checkpoint_store.list_model_runs("phase4-runtime-thread")
    assert checkpoint_state is not None
    assert checkpoint_state["model_run_id"] == model_runs[0].model_run_id
    assert model_runs[0].token_usage == started.provider_execution.token_usage
    assert model_runs[0].provider_name == "mock-provider"
    assert sink.payloads[0].status == "completed"
    assert sink.payloads[0].provider_name == "mock-provider"
    assert sink.payloads[0].token_usage == started.provider_execution.token_usage
    api_payload = sink.payloads[0].to_api_payload(api_job_run_id=42)
    assert api_payload["job_run_id"] == 42
    assert api_payload["status"] == "completed"
    assert api_payload["payload"]["thread_id"] == "phase4-runtime-thread"
    assert api_payload["payload"]["runtime_job_run_id"] == "phase4-runtime-job"

    resumed = runtime.resume(
        thread_id="phase4-runtime-thread",
        job_run_id="phase4-runtime-job",
        decision={"approved": True, "comment": "继续进入后续润色。"},
    )

    assert resumed.status == "completed"
    assert resumed.current_node == "human_approval"
    assert resumed.provider_execution.model_name == "storyforge-approval"
    records = checkpoint_store.list_records("phase4-runtime-thread")
    assert [record.current_node for record in records] == ["draft_writer", "human_approval"]
    assert records[-1].approval_status == "approved"


def test_workflow_runtime_keeps_recoverable_checkpoint_when_provider_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """provider 调用失败时，运行器应保留可恢复 checkpoint 和错误状态。"""

    def fail_provider_execution(**kwargs: object) -> ProviderExecutionResult:
        raise RuntimeError("provider timeout")

    monkeypatch.setattr("storyforge_workflow.runtime.runner.simulate_provider_execution", fail_provider_execution)
    checkpoint_store = RuntimeCheckpointStore()
    sink = CapturingModelRunSink(persisted_model_run_id=9002)
    runtime = WorkflowRuntime(checkpoint_store=checkpoint_store, model_run_sink=sink)

    failed = runtime.start(
        thread_id="phase5-runtime-failure",
        job_run_id="phase5-runtime-job",
        premise="远航舰队寻找新家园。",
        user_intent="验证失败恢复。",
        scene_packet={"scene_goal": "林岚争取维修窗口。"},
    )

    checkpoint_state = checkpoint_store.load_state("phase5-runtime-failure")
    assert failed.status == "failed"
    assert checkpoint_state is not None
    assert checkpoint_state["model_run_id"] == 9002
    assert checkpoint_state["error_code"] == "provider_execution_failed"
    assert checkpoint_state["current_node"] == "provider_execution"
    assert checkpoint_store.latest("phase5-runtime-failure").approval_status == "failed"
    assert checkpoint_store.list_model_runs("phase5-runtime-failure")[0].model_run_id == 1
    assert checkpoint_store.list_model_runs("phase5-runtime-failure")[0].status == "failed"
    assert sink.payloads[0].status == "failed"
    assert sink.payloads[0].error_message == "provider timeout"
    api_payload = sink.payloads[0].to_api_payload(api_job_run_id=43)
    assert api_payload["job_run_id"] == 43
    assert api_payload["status"] == "failed"
    assert api_payload["error_message"] == "provider timeout"
    assert api_payload["token_usage"] == 0
    assert api_payload["payload"]["thread_id"] == "phase5-runtime-failure"
    assert api_payload["payload"]["runtime_job_run_id"] == "phase5-runtime-job"



def test_model_run_payload_requires_persisted_api_job_run_id() -> None:
    """映射到 API ModelRun 时必须显式传入已持久化 JobRun 的正整数 ID。"""

    payload = ModelRunPayload(
        thread_id="phase5-runtime-thread",
        job_run_id="runtime-job-string",
        provider_name="mock-provider",
        model_name="storyforge-writer",
        capability="llm",
        latency_ms=10,
        token_usage=20,
        input_summary="输入摘要",
        output_summary="输出摘要",
        status="completed",
        error_message=None,
    )

    with pytest.raises(ValueError, match="正整数 ID"):
        payload.to_api_payload(api_job_run_id=0)
    with pytest.raises(ValueError, match="正整数 ID"):
        payload.to_api_payload(api_job_run_id=-1)
    with pytest.raises(ValueError, match="正整数 ID"):
        payload.to_api_payload(api_job_run_id="runtime-job-string")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="正整数 ID"):
        payload.to_api_payload(api_job_run_id=True)  # type: ignore[arg-type]

    api_payload = payload.to_api_payload(api_job_run_id=7)
    assert api_payload["job_run_id"] == 7
    assert api_payload["payload"]["runtime_job_run_id"] == "runtime-job-string"


def test_api_model_run_adapter_requires_persisted_api_job_run_id() -> None:
    """adapter 构造时必须拒绝 workflow 字符串 ID 和非正整数 ID。"""

    def record_api_model_run(api_payload: dict[str, object]) -> int:
        return 1

    invalid_ids = [0, -1, "runtime-job-string", True]
    for invalid_id in invalid_ids:
        with pytest.raises(ValueError, match="正整数 ID"):
            ApiModelRunAdapter(  # type: ignore[arg-type]
                api_job_run_id=invalid_id,
                record_api_model_run=record_api_model_run,
            )


def test_api_model_run_adapter_returns_persisted_model_run_id() -> None:
    """adapter 应使用 API JobRun.id 写入 payload，并返回真表 ModelRun.id。"""

    captured_payload: dict[str, object] = {}

    def record_api_model_run(api_payload: dict[str, object]) -> int:
        captured_payload.update(api_payload)
        return 8101

    payload = ModelRunPayload(
        thread_id="adapter-thread",
        job_run_id="runtime-job-string",
        provider_name="mock-provider",
        model_name="storyforge-writer",
        capability="llm",
        latency_ms=25,
        token_usage=35,
        input_summary="adapter 输入摘要",
        output_summary="adapter 输出摘要",
        status="completed",
        error_message=None,
    )

    adapter = ApiModelRunAdapter(api_job_run_id=77, record_api_model_run=record_api_model_run)
    model_run_id = adapter.record(payload)

    assert model_run_id == 8101
    assert captured_payload["job_run_id"] == 77
    assert captured_payload["payload"] == {"thread_id": "adapter-thread", "runtime_job_run_id": "runtime-job-string"}
