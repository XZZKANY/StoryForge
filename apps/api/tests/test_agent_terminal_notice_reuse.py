"""A cancelled new invocation must not emit an older terminal as a new notification."""

from __future__ import annotations

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import parse_agent_sse
from sqlalchemy import event
from test_agent_delivery_races import engine as engine

from app.domains.agent_runs import service


@pytest.mark.parametrize("prior_type,status", [("agent_run_completed", "completed"), ("agent_run_failed", "failed")])
def test_same_run_new_message_does_not_emit_old_terminal_after_losing_cas(
    client,
    monkeypatch,
    session_factory,
    engine,
    tmp_path,
    prior_type,
    status,  # noqa: F811
):
    session_id, run_id = "terminal-reuse-session", "terminal-reuse-run"
    _enable_loop_env(monkeypatch)
    replies = (
        [{"content": "First response."}, {"content": "Second response."}]
        if status == "completed"
        else [RuntimeError("First controlled failure"), RuntimeError("Second controlled failure")]
    )
    calls = _fake_llm_script(monkeypatch, replies)
    body = {
        "run_id": run_id,
        "user_message": "Summarize the project",
        "permission_profile": "read",
        "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
    }
    first = parse_agent_sse(client.post(f"/api/ide/agent/sessions/{session_id}/stream", json=body).text)
    assert first[-1]["type"] == "agent_result"
    before = client.get(f"/api/agent-runs/{run_id}/events").json()
    prior_ids = {e["id"] for e in before if e["event_type"] == prior_type}
    assert len(prior_ids) == 1
    stops = []

    def before_update(connection, cursor, statement, parameters, context, executemany):
        if not stops and statement.startswith("UPDATE agent_runs SET status=") and status in parameters:
            stops.append(None)
            with session_factory() as session:
                stopped = service.handle_agent_control_message(
                    session, public_id=run_id, session_id=session_id, control_type="stop_run"
                )
                stops[0] = service.websocket_control_event(stopped.event)

    body.update(user_message="Summarize again", assistant_session_id=first[-1]["assistant_session_id"])
    event.listen(engine, "before_cursor_execute", before_update)
    try:
        second = parse_agent_sse(client.post(f"/api/ide/agent/sessions/{session_id}/stream", json=body).text)
    finally:
        event.remove(engine, "before_cursor_execute", before_update)

    assert len(calls) == 2
    assert stops[0]["run_status"] == "stopped"
    assert second[-1]["runtime_interruption"]["status"] == "stopped"
    after = client.get(f"/api/agent-runs/{run_id}/events").json()
    assert {e["id"] for e in after if e["event_type"] == prior_type} == prior_ids
    stale_notifications = [f for f in second if f.get("type") == prior_type and f.get("event_id") in prior_ids]
    assert stale_notifications == []
