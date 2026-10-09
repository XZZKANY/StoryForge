"""Claim publication and the paused-to-running transition commit together."""

from __future__ import annotations

import pytest
import test_agent_delivery_races as delivery_race_support
from agent_loop_runtime_test_support import _enable_loop_env
from agent_transport import control_agent, parse_agent_sse
from sqlalchemy import event, select

from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.models import AgentRunEvent
from app.platform.ai_sdk import ChatResponse, ProviderCapabilities

engine = delivery_race_support.engine


@pytest.mark.parametrize("failure", ["insert", "commit"])
def test_resume_claim_failure_rolls_back_status_and_authority(
    client, monkeypatch, session_factory, engine, tmp_path, failure
):
    session_id, run_id = "atomic-resume-session", "atomic-resume-run"
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
            return ChatResponse(content="Known answer.")

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={
            "run_id": run_id,
            "user_message": "Summarize",
            "permission_profile": "read",
            "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
        },
    )
    assert parse_agent_sse(response.text)[-1]["runtime_interruption"]["status"] == "paused"
    triggered = []

    def fail_insert(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO agent_run_events") and "agent_execution_claimed" in parameters:
            triggered.append(True)
            raise RuntimeError("injected claim insert failure")

    def fail_commit(connection):
        present = connection.scalar(
            select(AgentRunEvent.id).where(AgentRunEvent.event_type == "agent_execution_claimed").limit(1)
        )
        if present is not None:
            triggered.append(True)
            raise RuntimeError("injected claim commit failure")

    name, callback = ("before_cursor_execute", fail_insert) if failure == "insert" else ("commit", fail_commit)
    event.listen(engine, name, callback)
    try:
        failed = control_agent(client, session_id, control_type="resume_run", run_id=run_id)
    finally:
        event.remove(engine, name, callback)

    assert failed["type"] == "error"
    assert triggered == [True]
    assert client.get(f"/api/agent-runs/{run_id}").json()["status"] == "paused"
    events = client.get(f"/api/agent-runs/{run_id}/events").json()
    assert not any(item["event_type"] == "agent_execution_claimed" for item in events)
    assert (
        next(item for item in reversed(events) if item["event_type"] == "resume_run")["payload"]["control_effect"]
        == "ignored"
    )
    retry = control_agent(client, session_id, control_type="resume_run", run_id=run_id)
    assert retry["control_effect"] == "applied"
    assert retry["run_status"] == "completed"
    assert retry["runtime_state"] == "settled"
    assert retry["resumed_result"]["agent_result"]["summary"] == "Known answer."
    assert len(calls) == 1
