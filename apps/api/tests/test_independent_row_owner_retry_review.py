"""Ownership publication retains earlier facts and savepoint retry boundaries."""

from __future__ import annotations

import pytest
import test_agent_delivery_races as delivery_race_support
from sqlalchemy import event, select

from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.agent_runs.service_execution import start_agent_execution
from app.domains.agent_runs.service_store import record_agent_event

engine = delivery_race_support.engine


def _seed_prior_history(session):
    run = AgentRun(public_id="independent-owner-retry", session_id="review-session", goal="Original goal")
    session.add(run)
    session.commit()
    owner = start_agent_execution(session, run)
    record_agent_event(session, run, event_type="tool_trace", actor="review", payload={"keep": "durable history"})
    history = [(item.id, item.sequence, item.event_type, item.payload) for item in session.scalars(
        select(AgentRunEvent).where(AgentRunEvent.run_id == run.id).order_by(AgentRunEvent.sequence)
    )]
    return run, owner.id, history


@pytest.mark.parametrize("kind", ["agent_execution_started", "agent_execution_claimed"])
def test_owner_sequence_retry_keeps_pending_and_committed_work(session_factory, kind):
    with session_factory() as session:
        run, _, history = _seed_prior_history(session)
        run_id = run.id
        run.goal = "Updated pending goal"
        artifact = AgentArtifact(run_id=run.id, kind="review_evidence", payload={"pending": "must survive retry"})
        session.add(artifact)
        conflicts = []

        def inject_sequence_conflict(flush_session, *_args):
            candidates = [item for item in flush_session.new if isinstance(item, AgentRunEvent) and item.event_type == kind]
            if conflicts or not candidates:
                return
            candidate = candidates[0]
            conflicts.append(candidate.sequence)
            flush_session.connection().execute(AgentRunEvent.__table__.insert().values(
                run_id=run_id, sequence=candidate.sequence, event_type="tool_trace", actor="rival-writer",
                payload={"temporary": "rolled back with conflicting savepoint"},
            ))

        event.listen(session, "before_flush", inject_sequence_conflict)
        try:
            recorded = record_agent_event(session, run, event_type=kind, actor="agent-runtime", payload={"retry": True})
        finally:
            event.remove(session, "before_flush", inject_sequence_conflict)
        assert conflicts == [3]
        new_owner = recorded.id
        artifact_id = artifact.id

    with session_factory() as reopened:
        run = reopened.get(AgentRun, run_id)
        assert run.goal == "Updated pending goal"
        assert run.execution_owner_event_id == new_owner
        assert reopened.get(AgentArtifact, artifact_id).payload == {"pending": "must survive retry"}
        rows = list(reopened.scalars(select(AgentRunEvent).where(AgentRunEvent.run_id == run_id).order_by(AgentRunEvent.sequence)))
        assert [(item.id, item.sequence, item.event_type, item.payload) for item in rows[:-1]] == history
        assert [item.sequence for item in rows] == [1, 2, 3]
        assert rows[-1].event_type == kind
        assert rows[-1].payload == {"retry": True}


@pytest.mark.parametrize("kind", ["agent_execution_started", "agent_execution_claimed"])
def test_owner_commit_failure_restores_prior_history_and_discards_pending_work(session_factory, engine, kind):
    with session_factory() as session:
        run, old_owner, history = _seed_prior_history(session)
        run_id = run.id
    failed = []

    def fail_commit(connection):
        failed.append(True)
        raise RuntimeError("independent outer commit failure")

    event.listen(engine, "commit", fail_commit)
    try:
        with session_factory() as session:
            run = session.get(AgentRun, run_id)
            run.goal = "Uncommitted change"
            session.add(AgentArtifact(run_id=run_id, kind="review_evidence", payload={"uncommitted": True}))
            with pytest.raises(RuntimeError, match="independent outer commit failure"):
                record_agent_event(session, run, event_type=kind, actor="agent-runtime", payload={})
            assert session.is_active
            assert not session.in_transaction()
    finally:
        event.remove(engine, "commit", fail_commit)
    assert failed == [True]
    with session_factory() as reopened:
        run = reopened.get(AgentRun, run_id)
        assert run.goal == "Original goal"
        assert run.execution_owner_event_id == old_owner
        assert list(reopened.scalars(select(AgentArtifact).where(AgentArtifact.run_id == run_id))) == []
        rows = list(reopened.scalars(select(AgentRunEvent).where(AgentRunEvent.run_id == run_id).order_by(AgentRunEvent.sequence)))
        assert [(item.id, item.sequence, item.event_type, item.payload) for item in rows] == history
