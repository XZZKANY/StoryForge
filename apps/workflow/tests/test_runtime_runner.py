from __future__ import annotations

from time import sleep

import pytest

from storyforge_workflow.runtime import (
    InMemoryRuntimeCheckpointStore,
    InMemoryWorkflowLifecycleStore,
    InMemoryWorkflowSessionStore,
    ModelRunPayload,
    RuntimeCheckpointStore,
    WorkflowRuntime,
)
from storyforge_workflow.runtime.checkpoints import ApiModelRunAdapter
from storyforge_workflow.runtime.provider_execution import ProviderExecutionResult


class CloseableCheckpointStore(InMemoryRuntimeCheckpointStore):
    """测试用 checkpoint store，记录运行器关闭时是否释放连接。"""

    def __init__(self) -> None:
        super().__init__()
        self.closed = False

    def close(self) -> None:
        self.closed = True


class CapturingModelRunSink:
    """测试用 sink，模拟后续 API ModelRun 真表 adapter。"""

    def __init__(self, persisted_model_run_id: int | None = None) -> None:
        self.persisted_model_run_id = persisted_model_run_id
        self.payloads: list[object] = []

    def record(self, payload: object) -> int | None:
        self.payloads.append(payload)
        return self.persisted_model_run_id


class FailingModelRunSink(CapturingModelRunSink):
    """测试用 sink，模拟诊断写入链路临时不可用。"""

    def record(self, payload: object) -> int | None:
        self.payloads.append(payload)
        raise RuntimeError("model run sink 写入失败")


def test_workflow_runtime_start_and_resume_records_provider_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    """运行器可把工作流中断、恢复和 provider 执行摘要记录到检查点仓库。"""

    def provider_execution(**kwargs: object) -> ProviderExecutionResult:
        return ProviderExecutionResult(
            capability=str(kwargs["capability"]),
            provider_name="openai-compatible",
            model_name="storyforge-writer",
            latency_ms=20,
            token_usage=30,
            summary=f"真实模型摘要：{kwargs['prompt_summary']}",
        )

    _stub_node_llm(monkeypatch)
    monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", provider_execution)
    checkpoint_store = InMemoryRuntimeCheckpointStore()
    lifecycle_store = InMemoryWorkflowLifecycleStore()
    session_store = InMemoryWorkflowSessionStore()
    sink = CapturingModelRunSink()
    runtime = WorkflowRuntime(
        checkpoint_store=checkpoint_store,
        model_run_sink=sink,
        lifecycle_store=lifecycle_store,
        session_store=session_store,
    )

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
    assert started.provider_execution.provider_name == "openai-compatible"
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
    assert model_runs[0].provider_name == "openai-compatible"
    assert sink.payloads[0].status == "completed"
    assert sink.payloads[0].provider_name == "openai-compatible"
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
    assert resumed.provider_execution.model_name == "storyforge-writer"
    records = checkpoint_store.list_records("phase4-runtime-thread")
    assert [record.current_node for record in records] == ["draft_writer", "human_approval"]
    assert records[-1].approval_status == "approved"
    events = lifecycle_store.list_events("phase4-runtime-thread")
    assert [event.status for event in events] == [
        "queued",
        "provider_running",
        "graph_running",
        "approval_waiting",
        "resuming",
        "completed",
    ]
    session = session_store.latest_for_thread("phase4-runtime-thread")
    assert session is not None
    assert session.status == "completed"
    assert session.current_node == "human_approval"
    assert session.prompt_history[-1].prompt_summary == str({"approved": True, "comment": "继续进入后续润色。"})


def test_workflow_runtime_close_releases_provider_executor_and_checkpoint_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """运行器关闭时应统一释放 provider 连接、节点 executor 与 checkpoint store。"""

    import storyforge_workflow.runtime.runner as runner_module

    closed: list[str] = []
    checkpoint_store = CloseableCheckpointStore()
    monkeypatch.setattr(runner_module, "close_provider_connections", lambda: closed.append("provider"))
    monkeypatch.setattr(runner_module, "close_workflow_node_executor", lambda: closed.append("executor"))
    runtime = WorkflowRuntime(checkpoint_store=checkpoint_store)

    runtime.close()

    assert closed == ["executor", "provider"]
    assert checkpoint_store.closed is True


def test_workflow_runtime_close_continues_cleanup_when_provider_close_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """单个 close 步骤失败时，运行器仍应继续释放后续资源。"""

    import storyforge_workflow.runtime.runner as runner_module

    closed: list[str] = []
    checkpoint_store = CloseableCheckpointStore()

    def fail_provider_close() -> None:
        closed.append("provider")
        raise RuntimeError("provider close failed")

    monkeypatch.setattr(runner_module, "close_workflow_node_executor", lambda: closed.append("executor"))
    monkeypatch.setattr(runner_module, "close_provider_connections", fail_provider_close)
    runtime = WorkflowRuntime(checkpoint_store=checkpoint_store)

    with pytest.raises(RuntimeError, match="provider close failed"):
        runtime.close()

    assert closed == ["executor", "provider"]
    assert checkpoint_store.closed is True


def test_workflow_runtime_ignores_model_run_sink_error_after_provider_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """诊断写入失败不应打断已成功的 provider 主路径。"""

    def provider_execution(**kwargs: object) -> ProviderExecutionResult:
        return ProviderExecutionResult(
            capability=str(kwargs["capability"]),
            provider_name="openai-compatible",
            model_name="storyforge-writer",
            latency_ms=20,
            token_usage=30,
            summary=f"真实模型摘要：{kwargs['prompt_summary']}",
        )

    _stub_node_llm(monkeypatch)
    monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", provider_execution)
    checkpoint_store = InMemoryRuntimeCheckpointStore()
    sink = FailingModelRunSink()
    runtime = WorkflowRuntime(checkpoint_store=checkpoint_store, model_run_sink=sink)

    started = runtime.start(
        thread_id="phase8-sink-success-thread",
        job_run_id="phase8-sink-success-job",
        premise="远航舰队寻找新家园。",
        user_intent="验证诊断写入隔离。",
        scene_packet={"scene_goal": "林岚争取维修窗口。"},
    )

    checkpoint_state = checkpoint_store.load_state("phase8-sink-success-thread")
    model_runs = checkpoint_store.list_model_runs("phase8-sink-success-thread")
    assert started.status == "interrupted"
    assert checkpoint_state is not None
    assert checkpoint_state["model_run_id"] == model_runs[0].model_run_id
    assert sink.payloads[0].status == "completed"


def test_workflow_runtime_keeps_provider_failure_when_model_run_sink_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """诊断写入失败不应覆盖 provider 原始失败路径。"""

    def fail_provider_execution(**kwargs: object) -> ProviderExecutionResult:
        raise RuntimeError("provider timeout")

    monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", fail_provider_execution)
    checkpoint_store = InMemoryRuntimeCheckpointStore()
    lifecycle_store = InMemoryWorkflowLifecycleStore()
    session_store = InMemoryWorkflowSessionStore()
    sink = FailingModelRunSink()
    runtime = WorkflowRuntime(
        checkpoint_store=checkpoint_store,
        model_run_sink=sink,
        lifecycle_store=lifecycle_store,
        session_store=session_store,
    )

    failed = runtime.start(
        thread_id="phase8-sink-failure-thread",
        job_run_id="phase8-sink-failure-job",
        premise="远航舰队寻找新家园。",
        user_intent="验证失败恢复。",
        scene_packet={"scene_goal": "林岚争取维修窗口。"},
    )

    checkpoint_state = checkpoint_store.load_state("phase8-sink-failure-thread")
    assert failed.status == "failed"
    assert checkpoint_state is not None
    assert checkpoint_state["model_run_id"] == 1
    assert checkpoint_state["error_code"] == "provider_execution_failed"
    assert checkpoint_store.latest("phase8-sink-failure-thread").approval_status == "failed"
    assert sink.payloads[0].status == "failed"
    assert sink.payloads[0].error_message == "provider timeout"
    failure_event = lifecycle_store.latest("phase8-sink-failure-thread")
    assert failure_event is not None
    assert failure_event.failure_kind == "provider_timeout"


def test_workflow_runtime_flushes_sqlite_snapshot_after_each_graph_node(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """运行器应在每个图节点完成后把当前引用状态刷新到 SQLite。"""

    def provider_execution(**kwargs: object) -> ProviderExecutionResult:
        return ProviderExecutionResult(
            capability=str(kwargs["capability"]),
            provider_name="openai-compatible",
            model_name="storyforge-writer",
            latency_ms=20,
            token_usage=30,
            summary=f"真实模型摘要：{kwargs['prompt_summary']}",
        )

    _stub_node_llm(monkeypatch)
    monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", provider_execution)
    sqlite_path = tmp_path / "runtime-snapshots.sqlite3"
    checkpoint_store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    runtime = WorkflowRuntime(checkpoint_store=checkpoint_store)

    runtime.start(
        thread_id="phase-f1-snapshot-thread",
        job_run_id="phase-f1-snapshot-job",
        premise="远航舰队寻找新家园。",
        user_intent="验证节点级快照。",
        scene_packet={
            "chapter_title": "暗潮",
            "chapter_goal": "舰队抵达灯塔港并争取维修窗口。",
            "scene_goal": "林岚在港口谈判中争取维修窗口。",
            "protagonist": "林岚",
            "required_facts": ["左臂受伤", "灯塔信号每七分钟重复"],
        },
    )

    reopened_store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    snapshots = reopened_store.list_state_snapshots("phase-f1-snapshot-thread")
    snapshot_nodes = [snapshot.current_node for snapshot in snapshots]

    assert snapshot_nodes[:4] == [
        "book_director",
        "scene_architect.chapter_plan",
        "scene_architect.scene_beats",
        "draft_writer",
    ]
    assert snapshots[-1].state["current_node"] == "draft_writer"
    assert "draft_excerpt" not in snapshots[-1].state


def test_workflow_runtime_keeps_recoverable_checkpoint_when_provider_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """provider 调用失败时，运行器应保留可恢复 checkpoint 和错误状态。"""

    def fail_provider_execution(**kwargs: object) -> ProviderExecutionResult:
        raise RuntimeError("provider timeout")

    monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", fail_provider_execution)
    checkpoint_store = InMemoryRuntimeCheckpointStore()
    lifecycle_store = InMemoryWorkflowLifecycleStore()
    session_store = InMemoryWorkflowSessionStore()
    sink = CapturingModelRunSink(persisted_model_run_id=9002)
    runtime = WorkflowRuntime(
        checkpoint_store=checkpoint_store,
        model_run_sink=sink,
        lifecycle_store=lifecycle_store,
        session_store=session_store,
    )

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
    failure_event = lifecycle_store.latest("phase5-runtime-failure")
    assert failure_event is not None
    assert failure_event.status == "recoverable_failed"
    assert failure_event.failure_kind == "provider_timeout"
    assert failure_event.current_node == "provider_execution"
    assert failure_event.recoverable is True
    session = session_store.latest_for_thread("phase5-runtime-failure")
    assert session is not None
    assert session.status == "recoverable_failed"


def test_workflow_runtime_marks_timed_out_node_as_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    """节点执行超过配置阈值时，运行器应记录可恢复失败 checkpoint。"""

    def provider_execution(**kwargs: object) -> ProviderExecutionResult:
        return ProviderExecutionResult(
            capability=str(kwargs["capability"]),
            provider_name="openai-compatible",
            model_name="storyforge-writer",
            latency_ms=20,
            token_usage=30,
            summary=f"真实模型摘要：{kwargs['prompt_summary']}",
        )

    quick_responses = iter(
        [
            "灯塔远航\n舰队如何找到新家园\n克制\n兑现迁徙史诗",
            "暗潮\n林岚争取维修窗口\n谈判压力与伤势互相挤压",
            "林岚压住左臂旧伤进入谈判。\n灯塔信号每七分钟重复一次。\n港口代表提出代价。",
        ]
    )

    def slow_draft_response(prompt: str, **kwargs) -> str:
        sleep(0.05)
        return "这段草稿不应在超时后继续推进。"

    monkeypatch.setenv("STORYFORGE_DRAFT_CRITIQUE_ENABLED", "0")
    monkeypatch.setenv("STORYFORGE_WORKFLOW_NODE_TIMEOUT_SECONDS", "0.001")
    monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", provider_execution)
    monkeypatch.setattr(
        "storyforge_workflow.nodes.director.generate_text", lambda prompt, **kwargs: next(quick_responses)
    )
    monkeypatch.setattr(
        "storyforge_workflow.nodes.scene_architect.generate_text", lambda prompt, **kwargs: next(quick_responses)
    )
    monkeypatch.setattr("storyforge_workflow.nodes.draft_writer.generate_text", slow_draft_response)
    checkpoint_store = InMemoryRuntimeCheckpointStore()
    lifecycle_store = InMemoryWorkflowLifecycleStore()
    session_store = InMemoryWorkflowSessionStore()
    runtime = WorkflowRuntime(
        checkpoint_store=checkpoint_store,
        lifecycle_store=lifecycle_store,
        session_store=session_store,
    )

    failed = runtime.start(
        thread_id="phase-f2-timeout-thread",
        job_run_id="phase-f2-timeout-job",
        premise="远航舰队寻找新家园。",
        user_intent="验证节点超时。",
        scene_packet={"scene_goal": "林岚争取维修窗口。"},
    )

    checkpoint_state = checkpoint_store.load_state("phase-f2-timeout-thread")
    latest_record = checkpoint_store.latest("phase-f2-timeout-thread")
    failure_event = lifecycle_store.latest("phase-f2-timeout-thread")
    session = session_store.latest_for_thread("phase-f2-timeout-thread")

    assert failed.status == "failed"
    assert failed.current_node == "draft_writer"
    assert checkpoint_state is not None
    assert checkpoint_state["current_node"] == "draft_writer"
    assert checkpoint_state["error_code"] == "node_timeout"
    assert latest_record is not None
    assert latest_record.approval_status == "failed"
    assert failure_event is not None
    assert failure_event.failure_kind == "node_timeout"
    assert failure_event.recoverable is True
    assert session is not None
    assert session.status == "recoverable_failed"


def test_workflow_runtime_marks_plain_node_error_as_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    """普通节点异常也应收敛为可恢复失败，避免运行态停在上一节点。"""

    def provider_execution(**kwargs: object) -> ProviderExecutionResult:
        return ProviderExecutionResult(
            capability=str(kwargs["capability"]),
            provider_name="openai-compatible",
            model_name="storyforge-writer",
            latency_ms=20,
            token_usage=30,
            summary=f"真实模型摘要：{kwargs['prompt_summary']}",
        )

    plan_responses = iter(
        [
            "灯塔远航\n舰队如何找到新家园\n克制\n兑现迁徙史诗",
            "畸形章纲\n只有两行",
        ]
    )

    monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", provider_execution)
    monkeypatch.setattr(
        "storyforge_workflow.nodes.director.generate_text", lambda prompt, **kwargs: next(plan_responses)
    )
    monkeypatch.setattr(
        "storyforge_workflow.nodes.scene_architect.generate_text", lambda prompt, **kwargs: next(plan_responses)
    )
    checkpoint_store = InMemoryRuntimeCheckpointStore()
    lifecycle_store = InMemoryWorkflowLifecycleStore()
    session_store = InMemoryWorkflowSessionStore()
    runtime = WorkflowRuntime(
        checkpoint_store=checkpoint_store,
        lifecycle_store=lifecycle_store,
        session_store=session_store,
    )

    failed = runtime.start(
        thread_id="phase-node-error-thread",
        job_run_id="phase-node-error-job",
        premise="远航舰队寻找新家园。",
        user_intent="验证普通节点异常收敛。",
        scene_packet={"scene_goal": "林岚争取维修窗口。"},
    )

    checkpoint_state = checkpoint_store.load_state("phase-node-error-thread")
    latest_record = checkpoint_store.latest("phase-node-error-thread")
    failure_event = lifecycle_store.latest("phase-node-error-thread")
    session = session_store.latest_for_thread("phase-node-error-thread")

    assert failed.status == "failed"
    assert failed.current_node == "scene_architect.chapter_plan"
    assert checkpoint_state is not None
    assert checkpoint_state["current_node"] == "scene_architect.chapter_plan"
    assert checkpoint_state["error_code"] == "node_execution_failed"
    assert latest_record is not None
    assert latest_record.approval_status == "failed"
    assert failure_event is not None
    assert failure_event.status == "recoverable_failed"
    assert failure_event.failure_kind == "unknown_runtime_error"
    assert failure_event.current_node == "scene_architect.chapter_plan"
    assert session is not None
    assert session.status == "recoverable_failed"


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


def test_workflow_runtime_threads_prompt_injection_into_draft_writer(monkeypatch: pytest.MonkeyPatch) -> None:
    """start 传入的装配注入键应经初始 state 流到 draft_writer 的分层 prompt。"""

    def provider_execution(**kwargs: object) -> ProviderExecutionResult:
        return ProviderExecutionResult(
            capability=str(kwargs["capability"]),
            provider_name="openai-compatible",
            model_name="storyforge-writer",
            latency_ms=20,
            token_usage=30,
            summary=f"真实模型摘要：{kwargs['prompt_summary']}",
        )

    plan_responses = iter(
        [
            "灯塔远航\n舰队如何找到新家园\n克制\n兑现迁徙史诗",
            "暗潮\n林岚争取维修窗口\n谈判压力与伤势互相挤压",
            "林岚压住左臂旧伤进入谈判。\n灯塔信号每七分钟重复一次。\n港口代表提出代价。",
        ]
    )
    captured_draft_prompts: list[str] = []

    def capture_draft_prompt(prompt: str, **kwargs) -> str:
        captured_draft_prompts.append(prompt)
        return "林岚把左臂藏进披风，没有解释。"

    monkeypatch.setenv("STORYFORGE_DRAFT_CRITIQUE_ENABLED", "0")
    monkeypatch.setattr(
        "storyforge_workflow.nodes.director.generate_text", lambda prompt, **kwargs: next(plan_responses)
    )
    monkeypatch.setattr(
        "storyforge_workflow.nodes.scene_architect.generate_text", lambda prompt, **kwargs: next(plan_responses)
    )
    monkeypatch.setattr("storyforge_workflow.nodes.draft_writer.generate_text", capture_draft_prompt)
    monkeypatch.setattr("storyforge_workflow.runtime.runner.execute_provider_text", provider_execution)
    checkpoint_store = InMemoryRuntimeCheckpointStore()
    runtime = WorkflowRuntime(checkpoint_store=checkpoint_store)

    started = runtime.start(
        thread_id="phase-injection-thread",
        job_run_id="phase-injection-job",
        premise="林岚在雾港追查失真的灯塔信号。",
        user_intent="突出克制悬疑。",
        scene_packet={"chapter_title": "占位标题", "scene_goal": "林岚争取维修窗口。"},
        prompt_injection={
            "character_constraints": [{"name": "林岚", "forbidden_traits": ["突然健谈"]}],
            "style_directive": {"forbidden_phrases": ["不禁"], "rules": ["多用动作与画面"]},
            "continuity_facts": [{"statement": "林岚：左臂受伤未愈", "must_appear": True}],
            "chapter_title_ref": "第一章 雾港",
        },
    )

    assert started.status == "interrupted"
    assert captured_draft_prompts, "draft_writer 应至少构造一次 prompt。"
    draft_prompt = captured_draft_prompts[-1]
    assert "林岚" in draft_prompt
    assert "禁止表现：突然健谈" in draft_prompt
    assert "禁用表达（绝不能出现）：不禁" in draft_prompt
    assert "林岚：左臂受伤未愈" in draft_prompt
    # chapter_title_ref 是起点：chapter_planner 节点会用自己的产出覆盖它，故这里不断言其存活。
    # 注入键属大上下文，绝不能渗进 checkpoint。
    checkpoint_state = checkpoint_store.load_state("phase-injection-thread")
    assert checkpoint_state is not None
    assert "character_constraints" not in checkpoint_state
    assert "style_directive" not in checkpoint_state
    assert "continuity_facts" not in checkpoint_state


def _stub_node_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    """固定节点 LLM 输出，避免运行器测试依赖外部模型。"""

    # 运行器测试只验证单遍主路径与持久化，关掉评审环以稳定节点序与调用计数（环另在 graph 测试覆盖）。
    monkeypatch.setenv("STORYFORGE_DRAFT_CRITIQUE_ENABLED", "0")
    responses = iter(
        [
            "灯塔远航\n舰队如何在旧伤与谈判压力中找到新家园\n克制、具画面感、重视连续性\n兑现迁徙史诗与个人代价",
            "暗潮\n林岚在港口谈判中争取维修窗口\n外部任务压力与角色隐秘状态互相挤压",
            "林岚压住左臂旧伤进入谈判。\n灯塔信号每七分钟重复一次。\n港口代表提出代价。",
            "林岚把左臂藏进披风，听见灯塔信号第七分钟再次回响。",
        ]
    )
    monkeypatch.setattr("storyforge_workflow.nodes.director.generate_text", lambda prompt, **kwargs: next(responses))
    monkeypatch.setattr(
        "storyforge_workflow.nodes.scene_architect.generate_text", lambda prompt, **kwargs: next(responses)
    )
    monkeypatch.setattr(
        "storyforge_workflow.nodes.draft_writer.generate_text", lambda prompt, **kwargs: next(responses)
    )
