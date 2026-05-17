from __future__ import annotations

from storyforge_workflow.runtime import RuntimeCheckpointStore, WorkflowRuntime


def test_workflow_runtime_start_and_resume_records_provider_execution() -> None:
    """运行器可把工作流中断、恢复和 provider 执行摘要记录到检查点仓库。"""

    checkpoint_store = RuntimeCheckpointStore()
    runtime = WorkflowRuntime(checkpoint_store=checkpoint_store)

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
