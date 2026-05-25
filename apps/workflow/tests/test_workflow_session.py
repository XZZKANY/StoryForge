from __future__ import annotations

from storyforge_workflow.runtime import InMemoryWorkflowSessionStore
from storyforge_workflow.runtime.session import SessionPromptEntry


def test_workflow_session_store_creates_session_with_required_fields() -> None:
    """??????????????????????"""

    store = InMemoryWorkflowSessionStore(clock_ms=lambda: 1000)

    session = store.create(
        session_id="session-1",
        thread_id="thread-1",
        job_run_id="job-1",
        workspace_id=42,
        status="queued",
        current_node="runtime_start",
        model_name="storyforge-writer",
    )

    assert session.session_id == "session-1"
    assert session.thread_id == "thread-1"
    assert session.job_run_id == "job-1"
    assert session.workspace_id == 42
    assert session.created_at_ms == 1000
    assert session.updated_at_ms == 1000
    assert session.status == "queued"
    assert session.current_node == "runtime_start"
    assert session.model_name == "storyforge-writer"
    assert session.prompt_history == []
    assert session.compaction is None
    assert session.last_heartbeat_ms is None
    assert store.get("session-1") == session
    assert store.latest_for_thread("thread-1") == session


def test_workflow_session_store_updates_status_and_current_node() -> None:
    """?????????????????????"""

    ticks = iter([1000, 1200])
    store = InMemoryWorkflowSessionStore(clock_ms=lambda: next(ticks))
    store.create(session_id="session-1", thread_id="thread-1", job_run_id="job-1")

    updated = store.update_status("session-1", status="provider_running", current_node="provider_execution")

    assert updated.status == "provider_running"
    assert updated.current_node == "provider_execution"
    assert updated.created_at_ms == 1000
    assert updated.updated_at_ms == 1200
    assert store.get("session-1") == updated


def test_workflow_session_store_appends_prompt_history() -> None:
    """?? prompt history ?????????????????"""

    ticks = iter([1000, 1300])
    store = InMemoryWorkflowSessionStore(clock_ms=lambda: next(ticks))
    store.create(session_id="session-1", thread_id="thread-1", job_run_id="job-1")

    updated = store.append_prompt(
        "session-1",
        node_name="provider_execution",
        prompt_summary="????::??????",
        model_name="storyforge-writer",
    )

    assert updated.updated_at_ms == 1300
    assert updated.model_name == "storyforge-writer"
    assert updated.prompt_history == [
        SessionPromptEntry(
            node_name="provider_execution",
            prompt_summary="????::??????",
            model_name="storyforge-writer",
            created_at_ms=1300,
        )
    ]


def test_workflow_session_store_updates_heartbeat() -> None:
    """heartbeat ????????????????????"""

    ticks = iter([1000, 1500])
    store = InMemoryWorkflowSessionStore(clock_ms=lambda: next(ticks))
    store.create(session_id="session-1", thread_id="thread-1", job_run_id="job-1")

    updated = store.heartbeat("session-1")

    assert updated.last_heartbeat_ms == 1500
    assert updated.updated_at_ms == 1500
