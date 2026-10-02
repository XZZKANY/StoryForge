from __future__ import annotations

import pytest
from agent_external_chat_test_support import live_setup

from app.domains.agent_runs import external_admission, host_lifecycle, host_lifecycle_router, service
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.domains.agent_runs.runtime_recovery import build_runtime_interruption_payload

GENERATION = "c" * 64


@pytest.fixture()
def lifecycle(monkeypatch):
    state = host_lifecycle.HostLifecycle()
    monkeypatch.setattr(host_lifecycle, "HOST_LIFECYCLE", state)
    monkeypatch.setattr(host_lifecycle_router, "HOST_LIFECYCLE", state)
    monkeypatch.setenv("STORYFORGE_MANAGED_HOST_GENERATION", GENERATION)
    return state


def test_closing_works_with_release_closed_and_wrong_generation_has_no_effect(client, session, lifecycle):
    assert external_admission.RELEASE_GATE_PASSED is False
    endpoint = "/api/agent-runs/host/closing"
    assert client.post(endpoint, headers={"X-StoryForge-Host-Generation": "d" * 64}).status_code == 409
    assert not lifecycle.closing
    headers = {"X-StoryForge-Host-Generation": GENERATION}
    response = client.post(endpoint, headers=headers)
    assert response.status_code == 200 and response.json() == {"closing": True, "settled": True, "in_flight_owners": 0}
    assert client.post(endpoint, headers=headers).json() == response.json()
    assert client.get(endpoint, headers=headers).json() == response.json()
    with pytest.raises(ExternalWritebackConflict, match="managed_host_closing"):
        service.start_agent_user_message_run(session, agent_session_id="new", message={"user_message": "no dispatch"})
    assert session.query(AgentRun).count() == session.query(AgentRunEvent).count() == 0


def test_paused_owner_is_still_in_flight_until_real_finally_settles(client, session, lifecycle):
    run = service.create_or_resume_agent_run(session, public_id="owner", session_id="session", goal="test")
    started = service.start_agent_execution(session, run)
    run.status = "paused"
    session.commit()
    lifecycle.begin_close()
    headers = {"X-StoryForge-Host-Generation": GENERATION}
    assert client.get("/api/agent-runs/host/closing", headers=headers).json() == {
        "closing": True,
        "settled": False,
        "in_flight_owners": 1,
    }
    # Terminal row status may precede finally; it is not proof the worker exited.
    run.status = "completed"
    session.commit()
    assert client.get("/api/agent-runs/host/closing", headers=headers).json()["in_flight_owners"] == 1
    run.status = "paused"
    session.commit()
    service.finish_agent_execution(session, run, started, None)
    assert client.get("/api/agent-runs/host/closing", headers=headers).json()["settled"]
    assert build_runtime_interruption_payload(run, boundary="before_model")["reason"] == "managed_host_closing"
    with pytest.raises(ExternalWritebackConflict):
        service.start_agent_execution(session, run)


def test_closing_at_provider_boundary_prevents_next_tool_and_finally_settles(session, tmp_path, monkeypatch, lifecycle):
    run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
    original_complete = provider.complete
    original_stream = provider.stream

    def complete(request):
        response = original_complete(request)
        lifecycle.begin_close()
        return response

    def stream(request):
        for event in original_stream(request):
            lifecycle.begin_close()
            yield event

    monkeypatch.setattr(provider, "complete", complete)
    monkeypatch.setattr(provider, "stream", stream)
    result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id, message=message)
    assert len(provider.requests) == 1 and revisions == []
    assert run.status == "paused" and result["type"] == "agent_result"
    assert host_lifecycle.host_close_status(session)["settled"]
    assert (root / "chapter.md").read_bytes() == "旧章\r\n".encode()
