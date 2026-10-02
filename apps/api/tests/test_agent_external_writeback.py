from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace
from threading import Barrier, Event

import pytest
from agent_external_writeback_test_support import AFTER, BEFORE, fixture, identity, ledger, observed
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.domains.agent_runs import service
from app.domains.agent_runs.event_types import APPROVE_PERMISSION_COMMAND, PAUSE_RUN, RESUME_RUN, STOP_RUN
from app.domains.agent_runs.loop.checkpoint_store import StoryForgeCheckpointStore, checkpoint_diagnostic
from app.domains.agent_runs.loop.external_wait_lifecycle import claim_external_execution
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.loop.external_wait_store import read_external_wait
from app.domains.agent_runs.loop.external_writeback import prepare_external_writeback, reconcile_external_writeback
from app.domains.agent_runs.loop.recovery import park_orphaned_checkpoint_run, resume_checkpoint_run
from app.domains.agent_runs.loop.sdk_adapters import (
    StoryForgeFeedbackFormatter,
    StoryForgeRuntimePolicy,
    StoryForgeToolSelector,
    build_storyforge_tool_registry,
)
from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.domains.agent_runs.service_execution import agent_execution_state
from app.platform.ai_sdk import MessageRole, RuntimeToolResult, ToolCall
from app.platform.ai_sdk.runtime import PendingToolCall, PolicyDecisionKind, RuntimePhase, ToolCallingRuntime


@pytest.fixture()
def engine(tmp_path):
    from app.db.base import Base

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'external.sqlite3'}", poolclass=NullPool,
                           connect_args={"timeout": 15})

    @event.listens_for(engine, "connect")
    def configure(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    yield engine
    engine.dispose()


def prepared(f):
    saved = f.publish()
    return prepare_external_writeback(f.context, wait_id=saved.wait.wait_id, expected_revision=saved.wait.revision,
                                     identity=identity(saved.wait), decision="approve",
                                     permission_profile=f.context.run.permission_profile)


def consume(f, saved):
    return reconcile_external_writeback(f.context, wait_id=saved.wait.wait_id, expected_revision=saved.wait.revision)


def claim(f, saved, **changes):
    args = dict(wait_id=saved.wait.wait_id, expected_revision=saved.wait.revision,
                execution_epoch="epoch-one", delivery_complete=True)
    args.update(changes)
    return claim_external_execution(f.context.session, f.context.run, **args)


def test_publish_v2_is_private_wait_not_completed_and_budget_survives_hidden_patch(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = f.publish()
        status, step, artifacts, events, evidence = observed(engine, f.context.run.id)
        assert status == "paused" and step == saved.wait.token and evidence == "running"
        assert artifacts[-1]["version"] == 2 and artifacts[-1]["write_budget_used"] == 1
        assert saved.wait.proposal.after == AFTER and saved.wait.raw_before == BEFORE
        assert f.context.outcome.proposed_patch is None and f.context.outcome.artifacts == []
        assert events[-1] == "agent_writeback_waiting"
        assert service.list_agent_artifacts(session, f.context.run.public_id) == []
        assert service.list_agent_checkpoints(session, f.context.run.public_id) == []
        event_payload = session.scalar(select(AgentRunEvent).order_by(AgentRunEvent.id.desc())).payload
        assert AFTER not in json.dumps(event_payload, ensure_ascii=False)
        assert len(f.provider.requests) == 1 and f.calls == ["propose"]
        assert (f.root / "chapter.md").read_bytes() == BEFORE.encode()
        assert not (f.root / ".storyforge").exists()
        registry = build_storyforge_tool_registry(f.context)
        assert all(t.metadata.get("patch_tool") is not True for t in StoryForgeToolSelector().select(registry, f.context))
        tool = registry.get("file_revise")
        assert StoryForgeRuntimePolicy(f.context).decide_tool(tool, PendingToolCall("second", "file_revise", {}), None).kind is PolicyDecisionKind.DENY
        formatted = StoryForgeFeedbackFormatter().format(
            RuntimeToolResult.failure("tool_not_available", "hidden"),
            call=ToolCall("second", "file_revise", "{}"), tool=tool, context=f.context,
        )
        assert "一次对话最多生成一个" in json.loads(formatted)["error"]
        with pytest.raises(ValueError, match="domain_transaction"):
            StoryForgeCheckpointStore(f.context).save(f.checkpoint)
        assert checkpoint_diagnostic(saved.prepared.payload, f.context.run)["can_resume"] is False


@pytest.mark.parametrize("failure", ["event_insert", "commit"])
def test_publication_failure_rolls_back_checkpoint_wait_and_event_without_adopting(engine, tmp_path, failure):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        before = observed(engine, f.context.run.id)
        old_cp, old_sources = f.context.latest_checkpoint, deepcopy(f.context.recovery_sources)

        def fail_insert(conn, cursor, statement, params, execution_context, executemany):
            if statement.startswith("INSERT INTO agent_run_events"):
                raise RuntimeError("injected")

        def fail_commit(s):
            if not s.in_nested_transaction():
                raise RuntimeError("injected")

        target, name, callback = ((engine, "before_cursor_execute", fail_insert) if failure == "event_insert"
                                  else (session, "before_commit", fail_commit))
        event.listen(target, name, callback)
        try:
            with pytest.raises(RuntimeError, match="injected"):
                f.publish()
        finally:
            event.remove(target, name, callback)
        assert observed(engine, f.context.run.id) == before
        assert f.context.latest_checkpoint == old_cp and f.context.recovery_sources == old_sources
        assert f.context.write_budget_used == 0
        assert f.publish().wait.revision == 1


@pytest.mark.parametrize("change,reason", [("raw", "raw_baseline"), ("source", "source_version"),
                                           ("continuation", "continuation"), ("redact", "redacted")])
def test_invalid_publication_never_grants_authority(engine, tmp_path, change, reason):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        if change == "raw":
            f.proposal = f.proposal.model_copy(update={"before": "not original"})
        elif change == "source":
            (f.root / "other.md").write_text("drift")
        elif change == "continuation":
            f.checkpoint = replace(f.checkpoint, continuation_omitted=True)
        else:
            f.context.source = {"STORYFORGE_LLM_API_KEY": "novel-secret"}
            f.proposal = f.proposal.model_copy(update={"after": "novel-secret"})
        baseline = observed(engine, f.context.run.id)
        with pytest.raises(ValueError, match=reason):
            f.publish()
        assert observed(engine, f.context.run.id) == baseline


def test_prepare_binds_once_but_is_not_a_write_or_success(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        baseline = observed(engine, f.context.run.id)
        repeat = prepare_external_writeback(f.context, wait_id=saved.wait.wait_id, expected_revision=1,
                                             identity=saved.wait.identity, decision="approve", permission_profile="ask")
        assert repeat.wait == saved.wait and observed(engine, f.context.run.id) == baseline
        assert f.calls == ["propose"] and not (f.root / ".storyforge").exists()
        with pytest.raises(ExternalWritebackConflict, match="already_bound"):
            prepare_external_writeback(f.context, wait_id=saved.wait.wait_id, expected_revision=2,
                                       identity=identity(saved.wait).model_copy(update={"fingerprint": "0" * 64}),
                                       decision="approve", permission_profile="ask")


@pytest.mark.parametrize("profile,confirmation,allow", [("ask", False, False), ("auto", True, False),
                                                        ("auto", False, True), ("full", False, True)])
def test_auto_preparation_requires_both_project_authority_and_proposal_permission(engine, tmp_path, profile, confirmation, allow):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path, profile=profile, confirmation=confirmation)
        saved = f.publish()
        kwargs = dict(wait_id=saved.wait.wait_id, expected_revision=1, identity=identity(saved.wait), decision="auto", permission_profile=profile)
        if allow:
            assert prepare_external_writeback(f.context, **kwargs).wait.stage == "awaiting_receipt"
        else:
            with pytest.raises(ExternalWritebackConflict, match="authorization"):
                prepare_external_writeback(f.context, **kwargs)


def test_receipt_consumption_is_atomic_once_and_same_run_reads_actual_disk(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        old_sources = deepcopy(saved.prepared.sources)
        ledger(saved.wait)
        ready = consume(f, saved)
        assert ready.wait.stage == "receipt_ready" and ready.wait.feedback_consumed
        assert ready.prepared.checkpoint.phase is RuntimePhase.AFTER_TOOL
        assert ready.prepared.checkpoint.pending is None
        assert ready.prepared.checkpoint.completed_tool_call_ids == ("write-call",)
        feedbacks = [m for m in ready.prepared.checkpoint.messages if m.role is MessageRole.TOOL]
        assert len(feedbacks) == 1 and json.loads(feedbacks[0].content)["applied"] is True
        for alias in ("chapter.md", "./chapter.md"):
            assert ready.prepared.sources["files"][alias]["sha256"] == ready.wait.after_hash
        assert ready.prepared.sources["files"]["other.md"] == old_sources["files"]["other.md"]
        assert observed(engine, f.context.run.id)[-1] == "completed"
        baseline = observed(engine, f.context.run.id)
        assert consume(f, saved).wait == ready.wait
        assert observed(engine, f.context.run.id) == baseline
        with pytest.raises(ExternalWritebackConflict, match="not_ready"):
            claim(f, ready)
        service.finish_agent_execution(session, f.context.run, f.started, None)
        assert agent_execution_state(session, f.context.run) == "settled"
        claimed = claim(f, ready)
        assert claimed.run_status == "running" and claimed.wait.delivery_complete
        assert agent_execution_state(session, f.context.run) == "in_flight"
        resumed = ToolCallingRuntime(f.provider, f.registry).run((), model="test", run_id=f.context.run.public_id,
                                                               resume_state=claimed.prepared.checkpoint)
        assert resumed.status.value == "completed" and f.calls == ["propose", "read"]
        assert len(f.provider.requests) == 2 and resumed.tool_attempts == 2
        read_feedback = next(m for m in f.provider.requests[-1].messages if m.tool_call_id == "read-call")
        assert json.loads(read_feedback.content).get("output", {}).get("content") == AFTER, read_feedback.content


@pytest.mark.parametrize("state,outcome,current,expected,consumed", [
    ("applied", False, AFTER, "outcome_unknown", False),
    ("applied", True, "author edit", "applied", False),
    ("not_written", True, BEFORE, "not_written", True),
    ("not_written", True, "author edit", "not_written", False),
])
def test_unknown_or_drift_never_invents_success_or_replays(engine, tmp_path, state, outcome, current, expected, consumed):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait, state=state, outcome=outcome, current=current)
        result = consume(f, saved)
        assert result.wait.observation.state == expected and result.wait.feedback_consumed is consumed
        assert f.calls == ["propose"] and len(f.provider.requests) == 1
        assert result.prepared.checkpoint.pending is None if consumed else result.prepared.checkpoint.pending is not None
        if not consumed:
            assert result.wait.stage == "reconciliation"
            assert not any(m.role is MessageRole.TOOL for m in result.prepared.checkpoint.messages)


def test_applied_history_kept_when_other_source_changes(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        (f.root / "other.md").write_text("peer drift")
        result = consume(f, saved)
        assert result.wait.observation.state == "applied" and result.wait.stage == "reconciliation"
        assert not result.wait.feedback_consumed and result.prepared.sources == saved.prepared.sources
        assert (f.root / "chapter.md").read_bytes() == AFTER.encode()


@pytest.mark.parametrize("failure", ["event_insert", "commit"])
def test_receipt_consume_failure_rolls_back_all_db_facts_but_preserves_disk_applied(engine, tmp_path, failure):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        baseline = observed(engine, f.context.run.id)
        old_cp, old_sources = f.context.latest_checkpoint, deepcopy(f.context.recovery_sources)

        def fail_insert(conn, cursor, statement, params, execution_context, executemany):
            if statement.startswith("INSERT INTO agent_run_events"):
                raise RuntimeError("injected")

        def fail_commit(s):
            if not s.in_nested_transaction():
                raise RuntimeError("injected")

        target, name, callback = ((engine, "before_cursor_execute", fail_insert) if failure == "event_insert"
                                  else (session, "before_commit", fail_commit))
        event.listen(target, name, callback)
        try:
            with pytest.raises(RuntimeError, match="injected"):
                consume(f, saved)
        finally:
            event.remove(target, name, callback)
        assert observed(engine, f.context.run.id) == baseline
        assert f.context.latest_checkpoint == old_cp and f.context.recovery_sources == old_sources
        assert (f.root / "chapter.md").read_bytes() == AFTER.encode()
        assert consume(f, saved).wait.feedback_consumed


@pytest.mark.parametrize("command", [RESUME_RUN, APPROVE_PERMISSION_COMMAND, PAUSE_RUN, STOP_RUN])
def test_ordinary_controls_cannot_drop_wait_or_authorize_dispatch(engine, tmp_path, command):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        service.finish_agent_execution(session, f.context.run, f.started, None)
        event = service.record_agent_control_event(session, public_id=f.context.run.public_id,
                                                   session_id="session", control_type=command)
        current = read_external_wait(session, f.context.run)
        assert current.wait.wait_id == saved.wait.wait_id and current.wait.identity == saved.wait.identity
        if command in {RESUME_RUN, APPROVE_PERMISSION_COMMAND}:
            assert current.wait == saved.wait and event.payload["control_effect"] == "ignored"
        else:
            assert current.wait.execution_epoch is None and current.wait.revision == saved.wait.revision + 1
        ledger(current.wait)
        result = consume(f, current)
        assert result.wait.observation.state == "applied"
        if command in {PAUSE_RUN, STOP_RUN}:
            with pytest.raises(ExternalWritebackConflict, match="not_ready"):
                claim(f, result)
        assert f.calls == ["propose"]


def test_restart_parks_original_wait_without_plain_resume(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        assert park_orphaned_checkpoint_run(session, f.context.run)
        current = read_external_wait(session, f.context.run)
        assert current.wait.wait_id == saved.wait.wait_id and current.wait.execution_epoch is None
        assert current.wait.proposal == saved.wait.proposal and current.wait.identity == saved.wait.identity
        assert agent_execution_state(session, f.context.run) == "settled"
        result, diagnostic = resume_checkpoint_run(session, f.context.run, agent_session_id="session",
                                                   execute_run=lambda *a, **k: pytest.fail("must not dispatch"))
        assert result is None and diagnostic["can_resume"] is False
        assert read_external_wait(session, f.context.run).wait.wait_id == saved.wait.wait_id


def test_concurrent_receipts_on_physical_connections_consume_once(engine, tmp_path, monkeypatch):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        run_id = f.context.run.id
    barrier = Barrier(2)
    from app.domains.agent_runs.loop import external_observation as external_writeback
    original = external_writeback.inspect_native_writeback

    def overlap(binding):
        result = original(binding)
        barrier.wait(timeout=10)
        return result

    monkeypatch.setattr(external_writeback, "inspect_native_writeback", overlap)

    def worker():
        with Session(engine, expire_on_commit=False) as session:
            ctx = replace(f.context, session=session, run=session.get(AgentRun, run_id))
            try:
                result = reconcile_external_writeback(ctx, wait_id=saved.wait.wait_id, expected_revision=saved.wait.revision)
                return result.wait.feedback_consumed
            except ExternalWritebackConflict:
                return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: worker(), range(2)))
    assert results.count(True) == 1
    final = observed(engine, run_id)
    assert final[3].count("agent_writeback_result") == 1
    assert final[-1] == "completed"
    assert final[2][-1]["checkpoint"]["completed_tool_call_ids"] == ["write-call"]


@pytest.mark.parametrize("change", ["epoch", "delivery", "permission", "target", "receipt"])
def test_worker_claim_checks_live_epoch_delivery_permission_disk_and_receipt(engine, tmp_path, change):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        ready = consume(f, saved)
        service.finish_agent_execution(session, f.context.run, f.started, None)
        changes = {}
        if change == "epoch":
            changes["execution_epoch"] = "old-epoch"
        elif change == "delivery":
            changes["delivery_complete"] = False
        elif change == "permission":
            f.context.run.permission_profile = "read"
            session.commit()
        elif change == "target":
            (f.root / "chapter.md").write_text("new author edit")
        else:
            (f.root / ".storyforge/writeback-receipts" / f"{saved.wait.identity.operation_id}.outcome.json").unlink()
        baseline = observed(engine, f.context.run.id)
        with pytest.raises(ExternalWritebackConflict):
            claim(f, ready, **changes)
        assert observed(engine, f.context.run.id) == baseline
        assert f.calls == ["propose"] and ready.wait.historical_applied


def test_observed_applied_history_not_erased_by_later_invalid_ledger(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait, current="author edit")
        first = consume(f, saved)
        assert first.wait.observation.state == "applied" and first.wait.historical_applied
        (f.root / ".storyforge/writeback-receipts" / f"{saved.wait.identity.operation_id}.intent.json").write_text("bad")
        second = consume(f, first)
        assert second.wait.observation.state == "invalid" and second.wait.historical_applied
        assert not second.wait.feedback_consumed


def test_permission_revocation_after_write_records_applied_but_cannot_continue(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        f.context.run.permission_profile = "read"
        session.commit()
        ready = consume(f, saved)
        assert ready.wait.historical_applied and ready.wait.feedback_consumed
        service.finish_agent_execution(session, f.context.run, f.started, None)
        with pytest.raises(ExternalWritebackConflict, match="context_changed"):
            claim(f, ready)
        assert (f.root / "chapter.md").read_bytes() == AFTER.encode()


def test_commit_success_followed_by_ack_failure_does_not_create_opposite_fact(engine, tmp_path, monkeypatch):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        committed = False
        original_refresh = session.refresh

        def after_commit(s):
            nonlocal committed
            if not s.in_nested_transaction():
                committed = True

        def fail_ack(instance, *a, **k):
            if committed:
                raise RuntimeError("injected ACK failure")
            return original_refresh(instance, *a, **k)

        event.listen(session, "after_commit", after_commit)
        try:
            with monkeypatch.context() as patch:
                patch.setattr(session, "refresh", fail_ack)
                with pytest.raises(RuntimeError, match="ACK"):
                    consume(f, saved)
        finally:
            event.remove(session, "after_commit", after_commit)
        facts = observed(engine, f.context.run.id)
        assert facts[3].count("agent_writeback_result") == 1 and facts[-1] == "completed"
        assert facts[2][-1]["checkpoint"]["completed_tool_call_ids"] == ["write-call"]
        ready = consume(f, saved)
        assert ready.wait.feedback_consumed and f.context.latest_checkpoint == ready.prepared.checkpoint
        assert observed(engine, f.context.run.id) == facts


def test_two_physical_connections_claim_one_segment_and_late_finally_cannot_settle_it(engine, tmp_path, monkeypatch):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        ready = consume(f, saved)
        service.finish_agent_execution(session, f.context.run, f.started, None)
        run_id = f.context.run.id
    barrier = Barrier(2)
    from app.domains.agent_runs import service_execution
    original = service_execution.agent_execution_state

    def overlap(session, run):
        state = original(session, run)
        barrier.wait(timeout=10)
        return state

    with monkeypatch.context() as patch:
        patch.setattr(service_execution, "agent_execution_state", overlap)

        def worker():
            with Session(engine, expire_on_commit=False) as session:
                try:
                    claimed = claim_external_execution(session, session.get(AgentRun, run_id),
                        wait_id=ready.wait.wait_id, expected_revision=ready.wait.revision,
                        execution_epoch="epoch-one", delivery_complete=True)
                    return claimed.wait.stage
                except ExternalWritebackConflict:
                    return "conflict"

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: worker(), range(2)))
    assert results.count("claimed") == 1 and results.count("conflict") == 1
    with Session(engine, expire_on_commit=False) as session:
        run = session.get(AgentRun, run_id)
        assert original(session, run) == "in_flight"
        service.finish_agent_execution(session, run, f.started, None)  # delayed old finally
        assert original(session, run) == "in_flight"
        new_start = session.scalar(select(AgentRunEvent).where(AgentRunEvent.event_type == "agent_execution_started").order_by(AgentRunEvent.id.desc()))
        service.finish_agent_execution(session, run, new_start, None)
        assert original(session, run) == "settled"


def test_restart_after_claim_settles_latest_owner_and_revokes_epoch(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        ready = consume(f, saved)
        service.finish_agent_execution(session, f.context.run, f.started, None)
        claim(f, ready)
        assert agent_execution_state(session, f.context.run) == "in_flight"
        assert park_orphaned_checkpoint_run(session, f.context.run)
        parked = read_external_wait(session, f.context.run)
        assert parked.run_status == "paused" and parked.wait.execution_epoch is None
        assert parked.wait.historical_applied and parked.wait.feedback_consumed
        assert agent_execution_state(session, f.context.run) == "settled"


@pytest.mark.parametrize("command", [PAUSE_RUN, STOP_RUN])
def test_receipt_and_control_before_finally_preserve_facts_without_second_owner(engine, tmp_path, command):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        consume(f, saved)
        event = service.record_agent_control_event(session, public_id=f.context.run.public_id,
                                                   session_id="session", control_type=command)
        assert event.payload["control_effect"] == "requested"
        assert agent_execution_state(session, f.context.run) == "in_flight"
        service.finish_agent_execution(session, f.context.run, f.started, None)
        parked = read_external_wait(session, f.context.run)
        assert parked.wait.historical_applied and parked.wait.feedback_consumed
        assert parked.wait.execution_epoch is None
        assert agent_execution_state(session, f.context.run) == "settled"
        with pytest.raises(ExternalWritebackConflict):
            claim(f, parked)
        assert f.calls == ["propose"] and observed(engine, f.context.run.id)[3].count("agent_execution_started") == 1


def test_read_profile_cannot_publish_a_write_wait_even_through_internal_entry(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path, profile="read")
        baseline = observed(engine, f.context.run.id)
        with pytest.raises(ExternalWritebackConflict, match="authorization"):
            f.publish()
        assert observed(engine, f.context.run.id) == baseline


def test_exact_revision_cas_blocks_prepare_after_concurrent_pause_with_same_status(engine, tmp_path, monkeypatch):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = f.publish()
        run_id = f.context.run.id
    binding_started, release = Event(), Event()
    from app.domains.agent_runs.loop import external_wait_state
    original = external_wait_state.bind_native_writeback

    def delayed_binding(**args):
        result = original(**args)
        binding_started.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(external_wait_state, "bind_native_writeback", delayed_binding)

    def worker():
        with Session(engine, expire_on_commit=False) as session:
            ctx = replace(f.context, session=session, run=session.get(AgentRun, run_id))
            with pytest.raises(ExternalWritebackConflict, match="revision_conflict"):
                prepare_external_writeback(ctx, wait_id=saved.wait.wait_id, expected_revision=1,
                                           identity=identity(saved.wait), decision="approve", permission_profile="ask")

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(worker)
        try:
            assert binding_started.wait(10)
            with Session(engine, expire_on_commit=False) as session:
                run = session.get(AgentRun, run_id)
                assert run.status == "paused"
                service.record_agent_control_event(session, public_id=run.public_id, session_id="session", control_type=PAUSE_RUN)
                current = read_external_wait(session, run)
                assert current.run_status == "paused" and current.wait.revision == 2
                assert current.wait.execution_epoch is None and current.wait.identity is None
        finally:
            release.set()
        future.result(timeout=15)
    facts = observed(engine, run_id)
    assert facts[3].count("agent_writeback_prepared") == 0
    assert facts[2][-1]["external_wait"]["execution_epoch"] is None


def test_wait_not_visible_on_other_connection_until_commit_and_adoption_after_commit(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        baseline = observed(engine, f.context.run.id)
        checkpoint = f.context.latest_checkpoint
        checks = []

        def inspect_before_commit(s):
            if not s.in_nested_transaction():
                checks.append(observed(engine, f.context.run.id))
                assert f.context.latest_checkpoint == checkpoint and f.context.write_budget_used == 0

        event.listen(session, "before_commit", inspect_before_commit)
        try:
            saved = f.publish()
        finally:
            event.remove(session, "before_commit", inspect_before_commit)
        assert checks == [baseline]
        assert observed(engine, f.context.run.id)[0] == "paused"
        assert f.context.latest_checkpoint == saved.prepared.checkpoint and f.context.write_budget_used == 1


def test_second_proposal_denied_from_persisted_budget_even_if_new_context_loses_display_state(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        f.publish()
        f.context.write_budget_used = 0
        assert f.context.outcome.proposed_patch is None
        baseline = observed(engine, f.context.run.id)
        with pytest.raises(ExternalWritebackConflict, match="write_budget_exhausted"):
            f.publish()
        assert observed(engine, f.context.run.id) == baseline


@pytest.mark.parametrize("command", [PAUSE_RUN, STOP_RUN])
def test_durable_cancel_intent_blocks_claim_even_before_control_state_transition(engine, tmp_path, command):
    from app.domains.agent_runs.run_payloads import control_event_type

    with Session(engine, expire_on_commit=False) as session:
        f = fixture(session, tmp_path)
        saved = prepared(f)
        ledger(saved.wait)
        ready = consume(f, saved)
        service.finish_agent_execution(session, f.context.run, f.started, None)
        # The control service deliberately commits its command audit first.
        service.record_agent_event(session, f.context.run, event_type=control_event_type(command),
                                   actor="desktop-ide", payload={"control_type": command})
        assert f.context.run.status == "paused" and ready.wait.execution_epoch == "epoch-one"
        baseline = observed(engine, f.context.run.id)
        with pytest.raises(ExternalWritebackConflict, match="control_requested"):
            claim(f, ready)
        assert observed(engine, f.context.run.id) == baseline
        assert agent_execution_state(session, f.context.run) == "settled"
