from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Lock

import pytest
from agent_external_chat_test_support import engine as engine
from agent_external_chat_test_support import lease, live_setup
from agent_external_writeback_test_support import AFTER, identity, ledger
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs import external_admission, service
from app.domains.agent_runs.loop import external_resume
from app.domains.agent_runs.loop.external_chat import external_control_context
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.loop.external_wait_store import read_external_wait
from app.domains.agent_runs.loop.external_writeback import prepare_external_writeback, reconcile_external_writeback
from app.domains.agent_runs.models import AgentRunEvent
from app.domains.agent_runs.service_store import get_agent_run


def ready(session, tmp_path, monkeypatch):
    monkeypatch.setattr(external_admission, "RELEASE_GATE_PASSED", True)
    monkeypatch.setenv("STORYFORGE_MANAGED_HOST_GENERATION", "a" * 64)
    monkeypatch.setenv("STORYFORGE_EXTERNAL_WRITEBACK_ENABLED", "1")
    run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
    service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                           message=message, external_lease=lease())
    context = external_control_context(session, run)
    current = read_external_wait(session, run)
    current = prepare_external_writeback(context, wait_id=current.wait.wait_id, expected_revision=current.wait.revision,
                                         identity=identity(current.wait), decision="approve", permission_profile="ask")
    ledger(current.wait)  # Synthetic Native ledger; this test measures physical DB/worker ownership.
    current = reconcile_external_writeback(context, wait_id=current.wait.wait_id, expected_revision=current.wait.revision)
    audit = root / ".storyforge/author-loop" / f"{current.wait.identity.operation_id}.md"
    audit.parent.mkdir(parents=True)
    body = "existing audit body"
    fields = {"operationId": current.wait.identity.operation_id, "payloadHash": "a" * 64,
              "bodyHash": hashlib.sha256(body.encode()).hexdigest()}
    audit.write_bytes((f"<!-- storyforge-writeback-audit-v1 {json.dumps(fields)} -->\n{body}"
                      "\n<!-- storyforge-writeback-audit-complete -->\n").encode())
    external_resume.request_external_continuation(session, run, wait_id=current.wait.wait_id,
                                                  expected_revision=current.wait.revision,
                                                  execution_epoch=lease().execution_epoch, host_generation="a" * 64)
    return run, root, provider, revisions


def test_two_physical_executors_claim_one_owner_and_continue_production_once(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, root, provider, revisions = ready(session, tmp_path, monkeypatch)
    barrier = Barrier(2)
    claim = external_resume.claim_external_execution

    def concurrent_claim(*args, **kwargs):
        barrier.wait(timeout=5)
        return claim(*args, **kwargs)

    monkeypatch.setattr(external_resume, "claim_external_execution", concurrent_claim)

    def dispatch():
        try:
            return external_resume.execute_ready_external_run(engine, "live-run")
        except ExternalWritebackConflict:
            return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: dispatch(), range(2)))
    assert sorted(results) == [False, True]
    with Session(engine) as session:
        run = get_agent_run(session, "live-run")
        assert run.status == "completed" and (root / "chapter.md").read_bytes() == AFTER.encode()
        assert session.query(AgentRunEvent).filter_by(event_type="agent_execution_started").count() == 2
    assert len(provider.requests) == 2 and len(revisions) == 1


def test_busy_queue_preserves_worker_settlement_kick_and_coalesces_duplicates(monkeypatch):
    entered = Event()
    release = Event()
    rerun = Event()
    lock = Lock()
    calls = []
    bind = object()

    def pending_old_worker(_bind, _run_id):
        with lock:
            calls.append((_bind, _run_id))
            first = len(calls) == 1
        if first:
            entered.set()
            assert release.wait(timeout=5)
            return False
        rerun.set()
        return True

    monkeypatch.setattr(external_resume, "execute_ready_external_run", pending_old_worker)
    external_resume.schedule_external_resume(bind, "queue-race")
    assert entered.wait(timeout=5)
    for _ in range(12):
        external_resume.schedule_external_resume(bind, "queue-race")
    release.set()
    assert rerun.wait(timeout=5)
    assert calls == [(bind, "queue-race"), (bind, "queue-race")]


def test_failed_queue_job_parks_the_wait_instead_of_silently_leaving_live_authority(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        ready(session, tmp_path, monkeypatch)
    settled = Event()
    park = external_resume.park_failed_external_dispatch

    def broken_dispatch(*args):
        raise RuntimeError("fixture dispatcher failure")

    def observed_park(*args):
        park(*args)
        settled.set()

    monkeypatch.setattr(external_resume, "execute_ready_external_run", broken_dispatch)
    monkeypatch.setattr(external_resume, "park_failed_external_dispatch", observed_park)
    external_resume.schedule_external_resume(engine, "live-run")
    assert settled.wait(timeout=5)
    with Session(engine) as session:
        run = get_agent_run(session, "live-run")
        current = read_external_wait(session, run)
        assert current.wait.execution_epoch is None and current.wait.historical_applied
        assert run.status == "paused"
        latest = session.scalar(select(AgentRunEvent).order_by(AgentRunEvent.sequence.desc()).limit(1))
        assert latest.payload["reason"] == "external_dispatch_failed"


def test_committed_cancel_audit_blocks_continuation_before_status_transition(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, root, provider, revisions = ready(session, tmp_path, monkeypatch)
        current = read_external_wait(session, run)
        service.record_agent_event(session, run, event_type="pause_run", actor="author", payload={})
        with pytest.raises(ExternalWritebackConflict, match="external_control_requested"):
            external_resume.request_external_continuation(session, run, wait_id=current.wait.wait_id,
                                                          expected_revision=current.wait.revision,
                                                          execution_epoch=lease().execution_epoch, host_generation="a" * 64)
        with pytest.raises(ExternalWritebackConflict, match="external_control_requested"):
            external_resume.execute_ready_external_run(engine, "live-run")
        assert len(provider.requests) == 1 and len(revisions) == 1
