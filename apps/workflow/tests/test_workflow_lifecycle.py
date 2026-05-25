from __future__ import annotations

from storyforge_workflow.runtime import (
    InMemoryWorkflowLifecycleStore,
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
