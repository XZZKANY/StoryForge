from __future__ import annotations

from storyforge_workflow.runtime import (
    InMemoryWorkflowLifecycleStore,
    RuntimeCheckpointStore,
    WorkflowFailureKind,
    WorkflowLifecycleStatus,
)


def test_workflow_lifecycle_records_start_approval_and_completed_sequence() -> None:
    """??????????????????????"""

    ticks = iter([1000, 1100, 1200, 1300])
    store = InMemoryWorkflowLifecycleStore(clock_ms=lambda: next(ticks))

    store.record(thread_id="thread-1", job_run_id="job-1", status=WorkflowLifecycleStatus.QUEUED, current_node="runtime_start", message="?????")
    store.record(thread_id="thread-1", job_run_id="job-1", status=WorkflowLifecycleStatus.PROVIDER_RUNNING, current_node="provider_execution", message="provider ???")
    store.record(thread_id="thread-1", job_run_id="job-1", status=WorkflowLifecycleStatus.APPROVAL_WAITING, current_node="human_approval", message="??????")
    store.record(thread_id="thread-1", job_run_id="job-1", status=WorkflowLifecycleStatus.COMPLETED, current_node="human_approval", message="????")

    events = store.list_events("thread-1")
    assert [event.status for event in events] == [
        "queued",
        "provider_running",
        "approval_waiting",
        "completed",
    ]
    assert [event.created_at_ms for event in events] == [1000, 1100, 1200, 1300]
    assert events[-1].current_node == "human_approval"
    assert events[-1].failure_kind is None
    assert events[-1].recoverable is None
    assert store.latest("thread-1") == events[-1]


def test_workflow_lifecycle_records_provider_recoverable_failure() -> None:
    """provider ?????????????????????????"""

    store = InMemoryWorkflowLifecycleStore(clock_ms=lambda: 2000)

    event = store.record_failure(
        thread_id="thread-1",
        job_run_id="job-1",
        current_node="provider_execution",
        message="provider timeout",
        failure_kind=WorkflowFailureKind.PROVIDER_TIMEOUT,
        recoverable=True,
    )

    assert event.status == "recoverable_failed"
    assert event.failure_kind == "provider_timeout"
    assert event.message == "provider timeout"
    assert event.current_node == "provider_execution"
    assert event.recoverable is True
    assert event.created_at_ms == 2000


def test_runtime_checkpoint_store_lists_incomplete_workflows_for_startup_resume(tmp_path) -> None:
    """启动时应能从 SQLite 找到未完成 workflow，并提供最后 checkpoint。"""

    sqlite_path = tmp_path / "workflow-runtime.sqlite3"
    store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    store.save_state(
        "thread-pending",
        {
            "thread_id": "thread-pending",
            "job_run_id": "job-pending",
            "current_node": "draft_writer",
            "approval_status": "pending",
            "scene_packet_id": 401,
        },
    )
    store.save_state(
        "thread-approved",
        {
            "thread_id": "thread-approved",
            "job_run_id": "job-approved",
            "current_node": "human_approval",
            "approval_status": "approved",
            "scene_packet_id": 402,
        },
    )

    restarted_store = RuntimeCheckpointStore(sqlite_path=sqlite_path)
    incomplete = restarted_store.list_incomplete_workflows()

    assert [snapshot.thread_id for snapshot in incomplete] == ["thread-pending"]
    assert incomplete[0].job_run_id == "job-pending"
    assert incomplete[0].current_node == "draft_writer"
    assert incomplete[0].state["scene_packet_id"] == 401
