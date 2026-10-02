from __future__ import annotations

import hashlib
import json

from agent_external_chat_test_support import engine as engine
from agent_external_chat_test_support import live_setup
from agent_external_writeback_test_support import AFTER, BEFORE, identity, ledger
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs import external_admission, writeback_router
from app.domains.agent_runs.loop.external_resume import execute_ready_external_run
from app.domains.agent_runs.loop.external_wait_store import read_external_wait
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.agent_runs.service_store import get_agent_run

GENERATION = "a" * 64
BASE = "/api/agent-runs/live-run/writeback"
STREAM = "/api/ide/agent/sessions/live-session/stream"


def negotiated(monkeypatch):
    # Synthetic managed-host fixture. Production release gate is never changed.
    monkeypatch.setattr(external_admission, "RELEASE_GATE_PASSED", True)
    monkeypatch.setenv("STORYFORGE_MANAGED_HOST_GENERATION", GENERATION)
    monkeypatch.setenv("STORYFORGE_EXTERNAL_WRITEBACK_ENABLED", "1")
    return {"X-StoryForge-Host-Generation": GENERATION}


def start_wait(client, session, tmp_path, monkeypatch, *, profile="ask"):
    _, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch, profile=profile, create_start=False)
    headers = negotiated(monkeypatch)
    response = client.post(STREAM, json={**message, "execution_protocol": "external_writeback_v1"}, headers=headers)
    assert response.status_code == 200
    frames = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
    assert frames[-1]["type"] == "agent_run_waiting" and frames[-1]["execution_epoch"]
    assert not any(f["type"] in {"agent_result", "permission_required", "agent_run_completed"} for f in frames)
    current = read_external_wait(session, get_agent_run(session, "live-run"))
    return current, root, provider, revisions, headers, frames[-1]["execution_epoch"]


def prepare(client, current, headers, *, decision="approve", profile="ask"):
    payload = {"session_id": "live-session", "expected_revision": current.wait.revision,
               "identity": identity(current.wait).model_dump(by_alias=True), "decision": decision,
               "permission_profile": profile}
    response = client.post(f"{BASE}/{current.wait.wait_id}/prepare", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json(), payload


def test_capability_default_closed_even_with_flags_or_loopback_headers(client, session, monkeypatch):
    assert external_admission.RELEASE_GATE_PASSED is False
    monkeypatch.setenv("STORYFORGE_MANAGED_HOST_GENERATION", GENERATION)
    monkeypatch.setenv("STORYFORGE_EXTERNAL_WRITEBACK_ENABLED", "1")
    response = client.get("/api/agent-runs/capabilities", headers={"X-StoryForge-Host-Generation": GENERATION})
    assert response.status_code == 200
    assert response.json() == {"execution_protocols": [], "managed_host_generation": GENERATION,
                               "disabled_reason": "release_gate_closed"}
    response = client.post(STREAM, json={"execution_protocol": "external_writeback_v1", "user_message": "Revise"})
    assert response.status_code == 409 and not session.query(AgentRun).count()
    assert not session.query(AgentRunEvent).count()


def test_negotiation_not_minted_by_headers_or_args_and_unknown_protocol_rejected(client, session, monkeypatch):
    negotiated(monkeypatch)
    for generation in (None, "b" * 64):
        response = client.post(STREAM, json={"execution_protocol": "external_writeback_v1", "user_message": "Revise"},
                               headers={} if generation is None else {"X-StoryForge-Host-Generation": generation})
        assert response.status_code == 409
    response = client.post(STREAM, json={"execution_protocol": "unknown", "user_message": "Revise"})
    assert response.status_code == 422 and not session.query(AgentRun).count()
    response = client.post(STREAM, json={"user_message": "Hello", "args": {"execution_protocol": "external_writeback_v1"}})
    assert response.status_code == 200
    assert '"type": "agent_result"' in response.text and '"type": "agent_run_waiting"' not in response.text


def test_scoped_read_is_no_effect_and_does_not_return_epoch_or_legacy_artifact(client, session, tmp_path, monkeypatch):
    current, root, provider, revisions, headers, epoch = start_wait(client, session, tmp_path, monkeypatch)
    assert get_agent_run(session, "live-run").scope["execution_protocol"] == "external_writeback_v1"
    event_count = session.query(AgentRunEvent).count()
    response = client.get(BASE, params={"session_id": "live-session"})
    assert response.status_code == 200
    projection = response.json()
    assert "execution_epoch" not in projection and projection["raw_before"] == BEFORE
    assert projection["runtime_state"] == "settled" and projection["proposal"]["after"] == AFTER
    assert projection["event_sequence"] == session.query(AgentRunEvent).order_by(AgentRunEvent.sequence.desc()).first().sequence
    assert session.query(AgentRunEvent).count() == event_count and len(provider.requests) == 1
    assert not (root / ".storyforge/writeback-receipts").exists()
    assert client.get(BASE, params={"session_id": "other-session"}).status_code == 404
    assert client.get(BASE).status_code == 422
    assert client.get(BASE, params={"session_id": "live-session"}, headers={"X-StoryForge-API-Key": "wrong"}).status_code == 401
    assert client.post(STREAM, json={"run_id": "live-run", "user_message": "Replay"}).status_code == 409
    assert read_external_wait(session, get_agent_run(session, "live-run")).wait == current.wait
    assert not session.query(AgentArtifact).filter_by(kind="proposed_patch").count()


def test_prepare_strict_identity_revision_host_and_ack_never_becomes_applied(client, session, tmp_path, monkeypatch):
    current, root, provider, revisions, headers, epoch = start_wait(client, session, tmp_path, monkeypatch)
    payload = {"session_id": "live-session", "expected_revision": 1, "identity": identity(current.wait).model_dump(by_alias=True),
               "decision": "approve", "permission_profile": "ask"}
    endpoint = f"{BASE}/{current.wait.wait_id}/prepare"
    assert client.post(endpoint, json={**payload, "outcome": "applied"}, headers=headers).status_code == 422
    assert client.post(endpoint, json={**payload, "expected_revision": True}, headers=headers).status_code == 422
    assert client.post(endpoint, json={**payload, "identity": {**payload["identity"], "fingerprint": "0" * 64}}, headers=headers).status_code == 409
    assert client.post(endpoint, json=payload, headers={"X-StoryForge-Host-Generation": "b" * 64}).status_code == 409
    projected, payload = prepare(client, current, headers)
    assert projected["stage"] == "awaiting_receipt" and projected["historical_applied"] is False
    assert projected["feedback_consumed"] is False and (root / "chapter.md").read_bytes() == BEFORE.encode()
    assert client.post(endpoint, json=payload, headers=headers).json() == projected
    assert len(provider.requests) == len(revisions) == 1


def test_applied_observe_does_not_continue_and_missing_audit_blocks_live_resume(client, session, tmp_path, monkeypatch):
    current, root, provider, revisions, headers, epoch = start_wait(client, session, tmp_path, monkeypatch)
    prepare(client, current, headers)
    current = read_external_wait(session, get_agent_run(session, "live-run"))
    ledger(current.wait)
    endpoint = f"{BASE}/{current.wait.wait_id}/reconcile"
    payload = {"session_id": "live-session", "expected_revision": current.wait.revision}
    assert client.post(endpoint, json={**payload, "outcome": "applied"}).status_code == 422
    response = client.post(endpoint, json=payload)
    assert response.status_code == 200
    applied = response.json()
    assert applied["historical_applied"] and applied["feedback_consumed"] and not applied["delivery_complete"]
    payload.update(expected_revision=applied["revision"], resume_intent="continue_current_execution", execution_epoch=epoch)
    denied = client.post(endpoint, json=payload, headers=headers)
    assert denied.status_code == 409 and denied.json()["detail"] == "external_delivery_audit_required"
    assert (root / "chapter.md").read_bytes() == AFTER.encode() and len(provider.requests) == 1
    assert session.query(AgentRunEvent).filter_by(event_type="agent_execution_started").count() == 1


def test_live_continue_is_short_scheduled_and_actual_executor_reuses_owner(client, session, tmp_path, monkeypatch):
    current, root, provider, revisions, headers, epoch = start_wait(client, session, tmp_path, monkeypatch)
    prepare(client, current, headers)
    current = read_external_wait(session, get_agent_run(session, "live-run"))
    ledger(current.wait)
    operation = current.wait.identity.operation_id
    audit = root / ".storyforge/author-loop"
    audit.mkdir()
    body = "synthetic audit body"
    metadata = {"operationId": operation, "payloadHash": "0" * 64,
                "bodyHash": hashlib.sha256(body.encode()).hexdigest()}
    (audit / f"{operation}.md").write_bytes(("<!-- storyforge-writeback-audit-v1 " + json.dumps(metadata) + " -->\n"
                                             + body + "\n<!-- storyforge-writeback-audit-complete -->\n").encode())
    scheduled = []
    monkeypatch.setattr(writeback_router, "schedule_external_resume", lambda bind, run_id: scheduled.append((bind, run_id)))
    response = client.post(f"{BASE}/{current.wait.wait_id}/reconcile", headers=headers,
                           json={"session_id": "live-session", "expected_revision": current.wait.revision,
                                 "resume_intent": "continue_current_execution", "execution_epoch": epoch})
    assert response.status_code == 200 and response.json()["delivery_complete"] is True
    assert len(scheduled) == 1 and len(provider.requests) == 1
    assert execute_ready_external_run(*scheduled[0]) is True
    with Session(session.get_bind()) as observer:
        run = get_agent_run(observer, "live-run")
        assert run.status == "completed" and len(provider.requests) == 2 and len(revisions) == 1
        assert observer.query(AgentRunEvent).filter_by(event_type="agent_execution_started").count() == 2
        artifact = observer.scalar(select(AgentArtifact).where(AgentArtifact.kind == "runtime_checkpoint")
                                   .order_by(AgentArtifact.id.desc()).limit(1))
        assert artifact.payload["external_wait"]["historical_applied"]
    # Terminal readonly reconstruction retains facts without a dispatch effect.
    assert client.get(BASE, params={"session_id": "live-session"}).json()["continuation_available"] is False


def test_reject_consumes_feedback_without_native_identity_or_write(client, session, tmp_path, monkeypatch):
    current, root, provider, revisions, headers, epoch = start_wait(client, session, tmp_path, monkeypatch)
    response = client.post(f"{BASE}/{current.wait.wait_id}/prepare", headers=headers,
                           json={"session_id": "live-session", "expected_revision": current.wait.revision,
                                 "decision": "reject", "permission_profile": "ask"})
    assert response.status_code == 200
    rejected = response.json()
    assert rejected["identity"] is None and rejected["decision"] == "reject" and rejected["feedback_consumed"]
    assert (root / "chapter.md").read_bytes() == BEFORE.encode() and len(provider.requests) == 1
    assert not (root / ".storyforge/writeback-receipts").exists()
    current = read_external_wait(session, get_agent_run(session, "live-run"))
    assert json.loads(current.prepared.checkpoint.messages[-1].content) == {"error": "作者拒绝了这份修订，文件未写回。"}
