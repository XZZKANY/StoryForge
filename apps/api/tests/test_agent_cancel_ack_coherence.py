"""Losing cancellation requests must report the worker's committed settlement."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from agent_loop_runtime_test_support import _enable_loop_env
from agent_transport import control_agent, parse_agent_sse
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.service_execution import agent_execution_state
from app.platform.ai_sdk import ChatResponse, ProviderCapabilities


@pytest.fixture
def engine(tmp_path):
    db = create_engine(
        f"sqlite:///{tmp_path / 'cancel-ack.sqlite'}",
        poolclass=NullPool,
        connect_args={"check_same_thread": False},
    )
    with db.begin() as connection:
        assert connection.exec_driver_sql("PRAGMA journal_mode=WAL").scalar() == "wal"
        Base.metadata.create_all(connection)
    yield db
    db.dispose()


@pytest.mark.parametrize("control_type", ["pause_run", "stop_run"])
def test_losing_cancel_ack_observes_worker_settlement(
    client, engine, monkeypatch, session_factory, tmp_path, control_type
):
    """The worker finishes after the control reads in_flight but before its CAS."""
    _enable_loop_env(monkeypatch)
    session_id = f"settled-{control_type}-session"
    run_id = f"settled-{control_type}-run"
    provider_entered, release_provider, control_waiting, release_control = (
        threading.Event() for _ in range(4)
    )
    provider_calls = []
    blocked_connection = []
    completion_connections = []
    control_rowcounts = []
    desired_status = "paused" if control_type == "pause_run" else "stopped"

    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=False)

        def complete(self, request):
            provider_calls.append(request)
            provider_entered.set()
            assert release_provider.wait(timeout=10)
            return ChatResponse(content="The project has been summarized.")

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())

    def before_update(connection, cursor, statement, parameters, context, executemany):
        if not statement.startswith("UPDATE agent_runs SET status="):
            return
        physical = connection.connection.driver_connection
        if parameters[0] == desired_status and not blocked_connection:
            blocked_connection.append(physical)
            control_waiting.set()
            assert release_control.wait(timeout=10)
        elif parameters[0] == "completed":
            completion_connections.append(physical)

    def after_update(connection, cursor, statement, parameters, context, executemany):
        if (
            statement.startswith("UPDATE agent_runs SET status=")
            and parameters[0] == desired_status
        ):
            control_rowcounts.append(cursor.rowcount)

    event.listen(engine, "before_cursor_execute", before_update)
    event.listen(engine, "after_cursor_execute", after_update)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            stream_future = pool.submit(
                client.post,
                f"/api/ide/agent/sessions/{session_id}/stream",
                json={
                    "run_id": run_id,
                    "user_message": "Summarize this project",
                    "permission_profile": "read",
                    "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
                },
            )
            try:
                assert provider_entered.wait(timeout=5)
                control_future = pool.submit(
                    control_agent, client, session_id, control_type=control_type, run_id=run_id
                )
                assert control_waiting.wait(timeout=5)
                with session_factory() as session:
                    run = service.get_agent_run(session, run_id)
                    assert run.status == "running"
                    assert agent_execution_state(session, run) == "in_flight"
                release_provider.set()
                stream_response = stream_future.result(timeout=10)
                assert stream_response.status_code == 200
                frames = parse_agent_sse(stream_response.text)
                assert frames[-1]["type"] == "agent_result"
                assert "runtime_interruption" not in frames[-1]
                with session_factory() as session:
                    run = service.get_agent_run(session, run_id)
                    assert run.status == "completed"
                    assert agent_execution_state(session, run) == "settled"
                release_control.set()
                ack = control_future.result(timeout=10)
            finally:
                release_provider.set()
                release_control.set()
    finally:
        event.remove(engine, "before_cursor_execute", before_update)
        event.remove(engine, "after_cursor_execute", after_update)

    assert len(provider_calls) == 1
    assert len(blocked_connection) == 1
    assert completion_connections
    assert all(physical is not blocked_connection[0] for physical in completion_connections)
    assert control_rowcounts == [0]
    persisted_events = client.get(f"/api/agent-runs/{run_id}/events").json()
    assert sum(item["event_type"] == "agent_run_completed" for item in persisted_events) == 1
    assert sum(item["event_type"] == "agent_execution_settled" for item in persisted_events) == 1
    assert not any(item["event_type"] == "agent_run_interrupted" for item in persisted_events)
    persisted_control = next(item for item in persisted_events if item["event_type"] == control_type)
    assert ack["control_effect"] == persisted_control["payload"]["control_effect"] == "ignored"
    assert ack["run_status"] == persisted_control["payload"]["run_status"] == "completed"
    assert ack["runtime_state"] == persisted_control["payload"]["runtime_state"] == "settled"
