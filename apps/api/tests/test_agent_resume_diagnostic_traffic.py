"""Resume ownership is tied to executions, not unrelated event traffic."""

from __future__ import annotations

from agent_loop_runtime_test_support import _enable_loop_env
from agent_transport import control_agent, parse_agent_sse
from sqlalchemy import event
from test_agent_delivery_races import engine  # noqa: F401 - independent WAL connections

from app.domains.agent_runs import loop_runtime, service
from app.platform.ai_sdk import ChatResponse, ProviderCapabilities


def test_normal_resume_survives_diagnostic_event_before_claim(client, monkeypatch, session_factory, engine, tmp_path):  # noqa: F811
    session_id, run_id = "resume-diagnostic-session", "resume-diagnostic-run"
    _enable_loop_env(monkeypatch)
    calls = []

    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=False)

        def complete(self, request):
            calls.append(request)
            with session_factory() as session:
                service.handle_agent_control_message(
                    session, public_id=run_id, session_id=session_id, control_type="pause_run"
                )
            return ChatResponse(content="Already generated answer.")

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={
            "run_id": run_id,
            "user_message": "Summarize this project.",
            "permission_profile": "read",
            "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
        },
    )
    assert parse_agent_sse(response.text)[-1]["runtime_interruption"]["status"] == "paused"
    diagnostic_ids = []

    def before_resume(connection, cursor, statement, parameters, context, executemany):
        if not diagnostic_ids and statement.startswith("UPDATE agent_runs SET status=") and "resumed" in parameters:
            with session_factory() as session:
                run = service.get_agent_run(session, run_id)
                recorded = service.record_agent_event(
                    session,
                    run,
                    event_type="agent_runtime_progress",
                    actor="test-diagnostics",
                    payload={"phase": "retry_started", "request_number": 2},
                )
                diagnostic_ids.append(recorded.id)

    event.listen(engine, "before_cursor_execute", before_resume)
    try:
        resumed = control_agent(client, session_id, control_type="resume_run", run_id=run_id)
    finally:
        event.remove(engine, "before_cursor_execute", before_resume)

    assert len(diagnostic_ids) == 1
    assert len(calls) == 1
    assert resumed["control_effect"] == "applied"
    assert resumed["run_status"] == "completed"
    assert resumed["runtime_state"] == "settled"
    assert resumed["resumed_result"]["run_id"] == run_id
    assert resumed["resumed_result"]["agent_result"]["summary"] == "Already generated answer."
    events = client.get(f"/api/agent-runs/{run_id}/events").json()
    assert sum(item["event_type"] == "agent_run_completed" for item in events) == 1
    assert any(item["id"] == diagnostic_ids[0] for item in events)
    duplicate = control_agent(client, session_id, control_type="resume_run", run_id=run_id)
    assert duplicate["control_effect"] == "ignored"
    assert duplicate["run_status"] == "completed"
    assert duplicate["runtime_state"] == "settled"
    assert len(calls) == 1
