from __future__ import annotations

from copy import deepcopy
from dataclasses import replace

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.domains.agent_runs import service
from app.domains.agent_runs.loop import checkpoint_store
from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
from app.domains.agent_runs.loop.types import ChatLoopOutcome
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.agent_runs.permission import PermissionGate
from app.domains.assistant.models import AssistantSession
from app.platform.ai_sdk import ChatMessage, MessageRole, RuntimeCheckpoint, ToolCall
from app.platform.ai_sdk.runtime import RuntimePhase


@pytest.fixture()
def engine(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'checkpoint.sqlite3'}", poolclass=NullPool)

    @event.listens_for(engine, "connect")
    def configure(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    yield engine
    engine.dispose()


def context(session, tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "chapter.md").write_bytes(b"before\r\n")
    run = service.create_or_resume_agent_run(session, public_id="checkpoint-run", session_id="s", goal="read")
    assistant = AssistantSession(title="checkpoint", task_type="revision")
    session.add(assistant)
    session.flush()
    run.assistant_session_id = assistant.id
    session.commit()

    def unused(name, args):
        raise AssertionError("no tool may execute")

    ctx = StoryForgeRuntimeContext(
        session=session, assistant_session_id=assistant.id, run=run, source={},
        permission_gate=PermissionGate(), definitions={}, execute_tool=unused, on_trace=lambda trace: None,
        outcome=ChatLoopOutcome(answer=""),
        recovery_message={"args": {"project_path": str(root), "file_path": "chapter.md"}},
    )
    cp = RuntimeCheckpoint(run.public_id, "test", RuntimePhase.BEFORE_MODEL,
                           (ChatMessage(MessageRole.USER, "read"),))
    return ctx, cp, root


def observed(engine, run_id):
    with Session(engine) as reader:
        run = reader.get(AgentRun, run_id)
        artifacts = list(reader.scalars(select(AgentArtifact).where(AgentArtifact.run_id == run_id)))
        events = list(reader.scalars(select(AgentRunEvent).where(AgentRunEvent.run_id == run_id)))
        return run.status, [a.payload for a in artifacts], [e.event_type for e in events]


def test_build_and_append_leave_commit_and_context_adoption_to_owner(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        ctx, cp, _ = context(session, tmp_path)
        prepared = checkpoint_store.build_checkpoint_payload(ctx, cp)
        assert ctx.recovery_sources is None and ctx.latest_checkpoint is None
        assert not session.new
        artifact = checkpoint_store.append_checkpoint(session, ctx.run, prepared)
        ctx.run.status = "paused"
        session.flush()
        assert artifact.id is not None
        assert observed(engine, ctx.run.id) == ("running", [], [])
        service.record_agent_event(session, ctx.run, event_type="interrupted", actor="test")
        status, payloads, events = observed(engine, ctx.run.id)
        assert status == "paused" and events == ["interrupted"]
        assert len(payloads) == 1 and payloads[0] == prepared.payload
        assert ctx.recovery_sources is None and ctx.latest_checkpoint is None
        checkpoint_store.adopt_checkpoint(ctx, prepared)
        assert ctx.latest_checkpoint == cp
        assert ctx.recovery_sources == prepared.sources


@pytest.mark.parametrize("failure", ["event_insert", "commit"])
def test_appended_checkpoint_event_and_run_transition_rollback_together(engine, tmp_path, failure):
    with Session(engine, expire_on_commit=False) as session:
        ctx, cp, _ = context(session, tmp_path)
        run_id = ctx.run.id
        prepared = checkpoint_store.build_checkpoint_payload(ctx, cp)

        def fail_insert(conn, cursor, statement, parameters, execution_context, executemany):
            if statement.lstrip().startswith("INSERT INTO agent_run_events"):
                raise RuntimeError("injected insert failure")

        def fail_commit(session):
            # The nested event SAVEPOINT also calls before_commit. Fail only at the outer boundary.
            if not session.in_nested_transaction():
                raise RuntimeError("injected commit failure")

        target, name, callback = ((engine, "before_cursor_execute", fail_insert) if failure == "event_insert"
                                  else (session, "before_commit", fail_commit))
        event.listen(target, name, callback)
        try:
            with pytest.raises(RuntimeError, match="injected"), service.rollback_failed_settlement(session):
                checkpoint_store.append_checkpoint(session, ctx.run, prepared)
                ctx.run.status = "paused"
                service.record_agent_event(session, ctx.run, event_type="interrupted", actor="test")
        finally:
            event.remove(target, name, callback)
        assert observed(engine, run_id) == ("running", [], [])
        assert ctx.latest_checkpoint is None and ctx.recovery_sources is None
        session.commit()
        assert observed(engine, run_id) == ("running", [], [])


def test_save_failure_does_not_advance_sources_or_latest_checkpoint(engine, tmp_path, monkeypatch):
    with Session(engine, expire_on_commit=False) as session:
        ctx, cp, root = context(session, tmp_path)
        store = checkpoint_store.StoryForgeCheckpointStore(ctx)
        store.save(cp)
        original = deepcopy(ctx.recovery_sources)
        (root / "chapter.md").write_text("changed")
        (root / "other.md").write_text("new source")
        next_cp = replace(cp, round_count=1, phase=RuntimePhase.MODEL_COMPLETED, messages=(*cp.messages,
            ChatMessage(MessageRole.ASSISTANT, "", tool_calls=(ToolCall("r2", "fs_read", '{"path":"other.md"}'),))))

        def fail():
            raise RuntimeError("injected commit failure")

        with monkeypatch.context() as patch:
            patch.setattr(session, "commit", fail)
            with pytest.raises(RuntimeError, match="injected"):
                store.save(next_cp)
        assert ctx.recovery_sources == original
        assert ctx.latest_checkpoint == cp
        assert len(observed(engine, ctx.run.id)[1]) == 1
        store.save(next_cp)
        assert ctx.latest_checkpoint == next_cp
        assert "other.md" in ctx.recovery_sources["files"]
        assert ctx.recovery_sources["files"]["chapter.md"] == original["files"]["chapter.md"]


def test_failed_build_does_not_modify_context_or_add_artifact(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        ctx, cp, root = context(session, tmp_path)
        (root / "directory").mkdir()
        ctx.recovery_message["args"]["file_path"] = "directory"
        with pytest.raises(ValueError, match="recovery_source_not_file"):
            checkpoint_store.build_checkpoint_payload(ctx, cp)
        assert ctx.recovery_sources is None and ctx.latest_checkpoint is None
        session.commit()
        assert observed(engine, ctx.run.id) == ("running", [], [])


def test_save_wrapper_keeps_v1_payload_digest_and_legacy_patch_confirmation(engine, tmp_path):
    with Session(engine, expire_on_commit=False) as session:
        ctx, cp, _ = context(session, tmp_path)
        ctx.outcome.proposed_patch = {"id": "patch", "requires_confirmation": False}
        store = checkpoint_store.StoryForgeCheckpointStore(ctx)
        store.save(cp)
        payload = observed(engine, ctx.run.id)[1][0]
        assert payload["version"] == 1
        assert payload["sha256"] == checkpoint_store.payload_digest(payload)
        assert checkpoint_store.checkpoint_diagnostic(payload, ctx.run)["can_resume"] is True
        assert store.load(ctx.run.public_id) == cp
        assert ctx.outcome.proposed_patch["requires_confirmation"] is True
