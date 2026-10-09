"""Initializer failure stays visible after its separate execution-exit marker."""

from __future__ import annotations

import json
import os
from pathlib import Path

from agent_transport import stream_agent_message

from app.domains.agent_runs import service
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.service_execution import agent_execution_state


def test_initializer_failure_remains_owned_replayable_and_live(client, monkeypatch, session_factory):
    class FailingRuntime:
        def __init__(self, event_sink, **kwargs):
            raise AgentOrchestrationError("Initializer role catalog failure")

    monkeypatch.setattr(service, "AgentRuntime", FailingRuntime)
    session_id, run_id = "independent-init-session", "independent-init-run"
    frames = stream_agent_message(
        client,
        session_id,
        run_id=run_id,
        user_message="Review this paragraph",
        intent="file.review",
        args={"file_path": "chapter.md", "content": "The harbor was quiet."},
    )
    assert frames[-1]["type"] == "error"
    assert "Initializer role catalog failure" in frames[-1]["detail"]
    assert frames[-1]["run_id"] == run_id
    assert not any(frame["type"] in {"agent_run_completed", "permission_required"} for frame in frames)

    events_response = client.get(f"/api/agent-runs/{run_id}/events")
    assert events_response.status_code == 200
    events = events_response.json()
    starts = [event for event in events if event["event_type"] == "agent_execution_started"]
    failures = [event for event in events if event["event_type"] == "agent_run_failed"]
    assert len(starts) == len(failures) == 1
    started, failed, settled = starts[0], failures[0], events[-1]
    assert failed["payload"]["execution_id"] == started["id"]
    assert "Initializer role catalog failure" in failed["message"]
    assert settled["event_type"] == "agent_execution_settled"
    assert settled["payload"]["execution_id"] == started["id"]
    assert settled["payload"]["run_status"] == "failed"
    assert failed["sequence"] < settled["sequence"]
    assert all(event["event_type"] != "agent_run_completed" for event in events)

    with session_factory() as session:
        run = service.get_agent_run(session, run_id)
        assert run.status == "failed"
        assert run.execution_owner_event_id == started["id"]
        assert agent_execution_state(session, run) == "settled"

    # Optional local review bridge into the real TypeScript replay selector.
    if export_path := os.getenv("STORYFORGE_INDEPENDENT_INIT_REVIEW_JSON"):
        Path(export_path).write_text(
            json.dumps({"events": events, "frames": frames, "sessionId": session_id, "runId": run_id}),
            encoding="utf-8",
        )
