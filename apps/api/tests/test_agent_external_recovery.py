from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_external_chat_test_support import engine as engine
from agent_external_chat_test_support import lease, live_setup
from agent_external_writeback_test_support import AFTER, BEFORE, identity, ledger
from sqlalchemy.orm import Session

from app.domains.agent_runs import external_admission, service
from app.domains.agent_runs.loop.external_chat import external_control_context
from app.domains.agent_runs.loop.external_wait_store import read_external_wait
from app.domains.agent_runs.loop.external_writeback import prepare_external_writeback, reconcile_external_writeback
from app.domains.agent_runs.models import AgentArtifact, AgentRunEvent
from app.domains.agent_runs.writeback_projection import read_writeback

GENERATION = "b" * 64
HEADERS = {"X-StoryForge-Host-Generation": GENERATION}


def waiting(session, tmp_path, monkeypatch, *, profile="ask"):
    _, message, root, provider, revisions = live_setup(
        session, tmp_path, monkeypatch, profile=profile, create_start=False
    )
    run = service.start_agent_user_message_run(
        session, agent_session_id="live-session", message=message, external_lease=lease()
    ).run
    service.execute_agent_user_message_run(
        session, run=run, agent_session_id=run.session_id, message=message, external_lease=lease()
    )
    monkeypatch.setattr(external_admission, "RELEASE_GATE_PASSED", True)
    monkeypatch.setenv("STORYFORGE_MANAGED_HOST_GENERATION", GENERATION)
    monkeypatch.setenv("STORYFORGE_EXTERNAL_WRITEBACK_ENABLED", "1")
    return run, root, provider, revisions


def recover(client, session, run, **updates):
    projected = read_writeback(session, run.public_id, run.session_id)
    payload = {
        "session_id": run.session_id,
        "expected_revision": projected.revision,
        "expected_event_sequence": projected.event_sequence,
        "permission_profile": run.permission_profile,
        **updates,
    }
    return client.post(
        f"/api/agent-runs/{run.public_id}/writeback/{projected.wait_id}/recover", json=payload, headers=HEADERS
    )


def test_cold_list_is_scoped_bounded_summary_with_no_effect(client, session, tmp_path, monkeypatch):
    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    counts = session.query(AgentArtifact).count(), session.query(AgentRunEvent).count()
    response = client.get("/api/agent-runs/writeback-recovery", params={"project_path": str(root)})
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["run_id"] == run.public_id and item["session_id"] == run.session_id
    assert "execution_epoch" not in item and "raw_before" not in item and "proposal" not in item
    assert counts == (session.query(AgentArtifact).count(), session.query(AgentRunEvent).count())
    assert len(provider.requests) == len(revisions) == 1 and (root / "chapter.md").read_bytes() == BEFORE.encode()
    assert (
        client.get(
            "/api/agent-runs/writeback-recovery", params={"project_path": str(root), "session_id": "other"}
        ).json()["items"]
        == []
    )
    assert (
        client.get("/api/agent-runs/writeback-recovery", params={"project_path": str(root), "limit": 21}).status_code
        == 422
    )


def test_manual_recovery_only_mints_live_qualification_and_strict_cas(client, session, tmp_path, monkeypatch):
    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch, profile="auto")
    old = read_writeback(session, run.public_id, run.session_id)
    response = recover(client, session, run)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["mode"] == "await_confirmation" and result["execution_epoch"] != "live-epoch"
    current = read_external_wait(session, run)
    assert current.wait.stage == "await_authorization" and current.wait.decision is None
    assert not current.wait.feedback_consumed and current.wait.execution_epoch == result["execution_epoch"]
    assert current.prepared.payload["external_execution"]["execution_epoch"] == result["execution_epoch"]
    assert (
        recover(
            client, session, run, expected_revision=old.revision, expected_event_sequence=old.event_sequence
        ).status_code
        == 409
    )
    assert recover(client, session, run, expected_event_sequence=old.event_sequence).status_code == 409
    assert recover(client, session, run, outcome="applied").status_code == 422
    assert len(provider.requests) == len(revisions) == 1 and not (root / ".storyforge").exists()


@pytest.mark.parametrize("command,allowed", [("pause_run", True), ("stop_run", False)])
def test_historical_pause_can_recover_but_stop_never_revives(client, session, tmp_path, monkeypatch, command, allowed):
    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    service.handle_agent_control_message(
        session, public_id=run.public_id, session_id=run.session_id, control_type=command
    )
    response = recover(client, session, run)
    assert response.status_code == (200 if allowed else 409), response.text
    assert session.query(AgentRunEvent).filter_by(event_type=command).count() == 1
    assert len(provider.requests) == 1


def bind(session, run):
    current = read_external_wait(session, run)
    return prepare_external_writeback(
        external_control_context(session, run),
        wait_id=current.wait.wait_id,
        expected_revision=current.wait.revision,
        identity=identity(current.wait),
        decision="approve",
        permission_profile=run.permission_profile,
    )


def audit(wait):
    import hashlib
    import json
    from pathlib import Path

    body = "synthetic bounded audit fixture"
    metadata = {
        "operationId": wait.identity.operation_id,
        "payloadHash": "0" * 64,
        "bodyHash": hashlib.sha256(body.encode()).hexdigest(),
    }
    path = Path(wait.project_path) / ".storyforge/author-loop"
    path.mkdir(parents=True, exist_ok=True)
    (path / f"{wait.identity.operation_id}.md").write_bytes(
        (
            "<!-- storyforge-writeback-audit-v1 "
            + json.dumps(metadata)
            + " -->\n"
            + body
            + "\n<!-- storyforge-writeback-audit-complete -->\n"
        ).encode()
    )


def test_prepared_missing_retains_identity_and_requires_new_epoch_explicit_approval(
    client, session, tmp_path, monkeypatch
):
    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch, profile="auto")
    prepared = bind(session, run)
    result = recover(client, session, run).json()
    assert result["mode"] == "await_confirmation"
    wait = result["writeback"]
    assert wait["identity"] == prepared.wait.identity.model_dump(by_alias=True)
    endpoint = f"/api/agent-runs/{run.public_id}/writeback/{prepared.wait.wait_id}/prepare"
    payload = {
        "session_id": run.session_id,
        "expected_revision": wait["revision"],
        "identity": wait["identity"],
        "decision": "approve",
        "permission_profile": "auto",
    }
    assert client.post(endpoint, json=payload, headers=HEADERS).status_code == 409
    assert client.post(endpoint, json={**payload, "execution_epoch": "live-epoch"}, headers=HEADERS).status_code == 409
    assert (
        client.post(
            endpoint,
            json={**payload, "decision": "auto", "execution_epoch": result["execution_epoch"]},
            headers=HEADERS,
        ).status_code
        == 409
    )
    approved = client.post(endpoint, json={**payload, "execution_epoch": result["execution_epoch"]}, headers=HEADERS)
    assert approved.status_code == 200, approved.text
    assert approved.json()["identity"] == wait["identity"]
    assert (root / "chapter.md").read_bytes() == BEFORE.encode() and len(provider.requests) == 1


@pytest.mark.parametrize("outcome,current", [(False, AFTER), (True, AFTER + "drift")])
def test_unknown_or_diverged_is_never_authorized(client, session, tmp_path, monkeypatch, outcome, current):
    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    prepared = bind(session, run)
    ledger(prepared.wait, outcome=outcome, current=current)
    counts = session.query(AgentArtifact).count(), session.query(AgentRunEvent).count()
    assert recover(client, session, run).status_code == 409
    assert counts == (session.query(AgentArtifact).count(), session.query(AgentRunEvent).count())
    assert len(provider.requests) == 1 and (root / "chapter.md").read_bytes() == current.encode()


def test_applied_audit_required_is_readonly_then_feedback_once_without_rewrite(client, session, tmp_path, monkeypatch):
    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    prepared = bind(session, run)
    ledger(prepared.wait)
    counts = session.query(AgentArtifact).count(), session.query(AgentRunEvent).count()
    result = recover(client, session, run).json()
    assert result["mode"] == "audit_required" and result["execution_epoch"] is None
    assert counts == (session.query(AgentArtifact).count(), session.query(AgentRunEvent).count())
    audit(prepared.wait)
    recovered = recover(client, session, run)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["mode"] == "continue_verified"
    saved = read_external_wait(session, run)
    assert saved.wait.feedback_consumed and saved.wait.historical_applied
    assert (
        sum(
            m.tool_call_id == saved.wait.tool_call_id and m.role.value == "tool"
            for m in saved.prepared.checkpoint.messages
        )
        == 1
    )
    counters = saved.prepared.checkpoint.round_count, saved.prepared.checkpoint.tool_attempts
    again = recover(client, session, run)
    assert again.status_code == 200 and again.json()["mode"] == "continue_verified"
    assert counters == (
        read_external_wait(session, run).prepared.checkpoint.round_count,
        read_external_wait(session, run).prepared.checkpoint.tool_attempts,
    )
    assert (root / "chapter.md").read_bytes() == AFTER.encode() and len(provider.requests) == 1


def test_post_watermark_cancel_blocks_prepare_even_before_status_transition(client, session, tmp_path, monkeypatch):
    from app.domains.agent_runs.service_store import record_agent_event

    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    result = recover(client, session, run).json()
    wait = read_external_wait(session, run).wait
    record_agent_event(session, run, event_type="pause_run", actor="desktop-ide", payload={"control_type": "pause_run"})
    with pytest.raises(ValueError, match="external_control_requested"):
        prepare_external_writeback(
            external_control_context(session, run),
            wait_id=wait.wait_id,
            expected_revision=wait.revision,
            identity=identity(wait),
            decision="approve",
            permission_profile="ask",
            execution_epoch=result["execution_epoch"],
        )
    assert (root / "chapter.md").read_bytes() == BEFORE.encode()


def test_two_physical_connections_recover_exactly_one_epoch(engine, tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from app.domains.agent_runs.loop.external_recovery import recover_external_wait
    from app.domains.agent_runs.service_store import get_agent_run

    with Session(engine) as session:
        run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
        old = read_writeback(session, run.public_id, run.session_id)
    barrier = Barrier(2)

    def attempt():
        with Session(engine) as session:
            run = get_agent_run(session, old.run_id)
            session.connection()
            barrier.wait(timeout=10)
            try:
                saved, mode = recover_external_wait(
                    session,
                    run,
                    wait_id=old.wait_id,
                    expected_revision=old.revision,
                    expected_event_sequence=old.event_sequence,
                    permission_profile="ask",
                    host_generation=GENERATION,
                )
                return saved.wait.execution_epoch
            except ValueError:
                session.rollback()
                return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: attempt(), range(2)))
    assert sum(result is not None for result in results) == 1
    with Session(engine) as session:
        assert session.query(AgentRunEvent).filter_by(event_type="agent_writeback_recovered").count() == 1


def test_manual_after_pause_applied_continues_same_frozen_run_only_on_second_action(
    client, session, tmp_path, monkeypatch
):
    from app.domains.agent_runs import writeback_router
    from app.domains.agent_runs.loop.external_resume import execute_ready_external_run

    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    prepared = bind(session, run)
    ledger(prepared.wait)
    audit(prepared.wait)
    service.handle_agent_control_message(
        session, public_id=run.public_id, session_id=run.session_id, control_type="pause_run"
    )
    result = recover(client, session, run).json()
    assert result["mode"] == "continue_verified" and len(provider.requests) == 1
    before = read_external_wait(session, run)
    assert not before.wait.delivery_complete
    scheduled = []
    monkeypatch.setattr(
        writeback_router, "schedule_external_resume", lambda bind, run_id: scheduled.append((bind, run_id))
    )
    response = client.post(
        f"/api/agent-runs/{run.public_id}/writeback/{before.wait.wait_id}/reconcile",
        headers=HEADERS,
        json={
            "session_id": run.session_id,
            "expected_revision": before.wait.revision,
            "resume_intent": "continue_current_execution",
            "execution_epoch": result["execution_epoch"],
        },
    )
    assert response.status_code == 200, response.text
    assert len(scheduled) == 1 and len(provider.requests) == 1
    assert execute_ready_external_run(*scheduled[0])
    assert len(provider.requests) == 2 and len(revisions) == 1
    session.refresh(run)
    assert run.status == "completed" and (root / "chapter.md").read_bytes() == AFTER.encode()
    assert session.query(AgentRunEvent).filter_by(event_type="pause_run").count() == 1
    assert session.query(AgentRunEvent).filter_by(event_type="agent_execution_started").count() == 2


@pytest.mark.parametrize("unsafe", [False, True])
def test_claimed_checkpoint_retains_budget_and_refuses_model_outcome_unknown(
    client, session, tmp_path, monkeypatch, unsafe
):
    from dataclasses import replace

    from app.domains.agent_runs.loop.external_wait_lifecycle import claim_external_execution, park_external_wait
    from app.domains.agent_runs.loop.external_wait_store import commit_external_transition

    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    prepared = bind(session, run)
    ledger(prepared.wait)
    audit(prepared.wait)
    current = reconcile_external_writeback(
        external_control_context(session, run), wait_id=prepared.wait.wait_id, expected_revision=prepared.wait.revision
    )
    claim_external_execution(
        session,
        run,
        wait_id=current.wait.wait_id,
        expected_revision=current.wait.revision,
        execution_epoch="live-epoch",
        delivery_complete=True,
    )
    park_external_wait(session, run, reason="explicit_test_startup_park")
    current = read_external_wait(session, run)
    if unsafe:
        payload = {**current.prepared.payload, "dispatch_state": "model_outcome_unknown"}
        commit_external_transition(
            session,
            run,
            previous=current,
            prepared=replace(current.prepared, payload=payload),
            wait=current.wait,
            event_type="agent_writeback_progress",
        )
    response = recover(client, session, run)
    assert response.status_code == (409 if unsafe else 200), response.text
    if not unsafe:
        saved = read_external_wait(session, run)
        assert saved.wait.stage == "claimed" and saved.prepared.checkpoint == current.prepared.checkpoint
        assert saved.prepared.payload["active_elapsed_seconds"] == current.prepared.payload["active_elapsed_seconds"]
        assert saved.prepared.payload["write_budget_used"] == 1
    assert len(provider.requests) == 1 and (root / "chapter.md").read_bytes() == AFTER.encode()


@pytest.mark.parametrize("metadata", [None, [], "invalid", 1])
def test_malformed_private_execution_metadata_is_fixed_conflict_not_parser_error(
    client, session, tmp_path, monkeypatch, metadata
):
    from dataclasses import replace

    from app.domains.agent_runs.loop.external_wait_store import (
        commit_external_transition,
        latest_external_event_sequence,
    )

    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    current = read_external_wait(session, run)
    commit_external_transition(
        session,
        run,
        previous=current,
        prepared=replace(current.prepared, payload={**current.prepared.payload, "external_execution": metadata}),
        wait=current.wait,
        event_type="agent_writeback_progress",
    )
    before = session.query(AgentArtifact).count(), session.query(AgentRunEvent).count()
    listed = client.get("/api/agent-runs/writeback-recovery", params={"project_path": str(root)})
    assert listed.status_code == 200
    assert listed.json()["items"][0]["blocked_reason"] == "external_recovery_checkpoint_invalid"
    response = client.post(
        f"/api/agent-runs/{run.public_id}/writeback/{current.wait.wait_id}/recover",
        headers=HEADERS,
        json={
            "session_id": run.session_id,
            "expected_revision": current.wait.revision,
            "expected_event_sequence": latest_external_event_sequence(session, run),
            "permission_profile": "ask",
        },
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "external_recovery_checkpoint_unsafe"}
    assert before == (session.query(AgentArtifact).count(), session.query(AgentRunEvent).count())
    assert len(provider.requests) == 1 and (root / "chapter.md").read_bytes() == BEFORE.encode()


CORRUPTIONS = ("truncated", "oversized", "duplicate_field", "orphaned_outcome", "identity_mismatch")


def corrupt_receipt(wait, kind):
    """Break exactly one field of an otherwise valid receipt pair."""
    directory = Path(wait.canonical_root) / ".storyforge" / "writeback-receipts"
    bound = wait.binding()
    op = bound.identity.operation_id
    intent_path = directory / f"{op}.intent.json"
    outcome_path = directory / f"{op}.outcome.json"
    intent = {
        "schemaVersion": 1,
        "operationId": op,
        "fingerprint": bound.identity.fingerprint,
        "relativePath": bound.identity.relative_path,
        "beforeHash": bound.before_hash,
        "afterHash": bound.after_hash,
        "checkpointTimestamp": 7,
    }
    if kind == "truncated":
        intent_path.write_text("{", encoding="utf-8")
    elif kind == "oversized":
        intent_path.write_bytes(b'{"pad":"' + b"x" * (64 * 1024 + 1) + b'"}')
    elif kind == "duplicate_field":
        intent_path.write_text(
            json.dumps(intent)[:-1] + f',"operationId":"{op}"}}', encoding="utf-8"
        )
    elif kind == "orphaned_outcome":
        outcome_path.write_text(
            json.dumps({**intent, "state": "applied", "detail": None}), encoding="utf-8"
        )
        intent_path.unlink()
    elif kind == "identity_mismatch":
        intent_path.write_text(json.dumps({**intent, "operationId": "0" * 64}), encoding="utf-8")


@pytest.mark.parametrize("kind", CORRUPTIONS)
def test_corrupt_receipt_is_isolated_and_recover_reports_conflict(
    client, session, tmp_path, monkeypatch, kind
):
    """A damaged receipt must not 500 the recovery surface or authorize anything."""
    run, root, provider, revisions = waiting(session, tmp_path, monkeypatch)
    prepared = bind(session, run)
    ledger(prepared.wait)
    corrupt_receipt(prepared.wait, kind)
    baseline = (root / "chapter.md").read_bytes()
    before = session.query(AgentArtifact).count(), session.query(AgentRunEvent).count()
    listed = client.get("/api/agent-runs/writeback-recovery", params={"project_path": str(root)})
    assert listed.status_code == 200, listed.text
    item = listed.json()["items"][0]
    assert item["blocked_reason"] == "external_recovery_receipt_unsafe"
    assert item["native_state"] is None and item["target_current"] is None
    response = recover(client, session, run)
    assert response.status_code == 409
    assert response.json() == {"detail": "external_recovery_receipt_unsafe"}
    assert before == (session.query(AgentArtifact).count(), session.query(AgentRunEvent).count())
    assert len(provider.requests) == len(revisions) == 1
    assert (root / "chapter.md").read_bytes() == baseline
