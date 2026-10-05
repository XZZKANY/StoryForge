from __future__ import annotations

import subprocess
import sys
from dataclasses import replace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.models import AgentRun
from app.domains.assistant import service as assistant_service
from app.platform.ai_sdk import ChatResponse, TokenUsage, ToolCall


@pytest.fixture()
def durable_engine(tmp_path):
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'recovery.sqlite3'}", poolclass=NullPool)

    @event.listens_for(engine, "connect")
    def configure(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    yield engine
    engine.dispose()


def _directory_alias(alias, target):
    if sys.platform == "win32":
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(alias), str(target)],
                                capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr.decode(errors="replace")
    else:
        alias.symlink_to(target, target_is_directory=True)


@pytest.mark.parametrize("drift", ["none", "file", "instructions", "permission", "checkpoint", "pinned", "alias_missing", "alias_retarget", "tool_policy"])
def test_control_resume_after_database_reopen_reuses_completed_tool_result(
    durable_engine, tmp_path, monkeypatch, drift,
):
    project = tmp_path / "project"
    project.mkdir()
    chapter = project / "chapter.md"
    chapter.write_text("original evidence", encoding="utf-8")
    pinned = project / "setting.md"
    pinned.write_text("The author forbids time travel", encoding="utf-8")
    read_path = "chapter.md"
    alias = project / "alias"
    if drift.startswith("alias_"):
        original = project / "original"
        original.mkdir()
        (original / "chapter.md").write_text("original evidence", encoding="utf-8")
        _directory_alias(alias, original)
        read_path = "alias/chapter.md"
    requests = []

    class Provider:
        def complete(self, request):
            requests.append(request)
            if len(requests) == 1:
                return ChatResponse(content="", tool_calls=(ToolCall("read-1", "fs_read", '{"path":"' + read_path + '"}'),),
                                    usage=TokenUsage(input_tokens=10, output_tokens=2))
            return ChatResponse(content="resumed answer", usage=TokenUsage(input_tokens=20, output_tokens=3))

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())

    def pause_after_tool(item):
        if item.event_type == "tool_trace" and item.payload.get("trace", {}).get("tool_name") == "fs.read":
            with Session(durable_engine) as controller:
                service.record_agent_control_event(controller, public_id="durable-run", session_id="durable-session",
                                                   control_type="pause_run")

    with Session(durable_engine) as worker:
        first = service.run_agent_user_message(worker, agent_session_id="durable-session", message={
            "run_id": "durable-run", "user_message": "Read the chapter", "intent": "chat.explain",
            "args": {"project_path": str(project), "context_bundle": {"files": [
                {"relative_path": "setting.md", "excerpt": pinned.read_text(encoding="utf-8")},
            ]}},
        }, on_event=pause_after_tool)
        assert first.run.status == "paused"
        assert len(requests) == 1
        run_id = first.run.id
    durable_engine.dispose()
    if drift == "file":
        chapter.write_text("different content must not replace completed evidence", encoding="utf-8")
    if drift == "pinned":
        pinned.write_text("The author now permits time travel", encoding="utf-8")
    if drift.startswith("alias_"):
        if sys.platform == "win32":
            alias.rmdir()
        else:
            alias.unlink()
        if drift == "alias_retarget":
            replacement = project / "replacement"
            replacement.mkdir()
            (replacement / "chapter.md").write_text("original evidence", encoding="utf-8")
            _directory_alias(alias, replacement)
    if drift == "instructions":
        (project / ".storyforge").mkdir(exist_ok=True)
        (project / ".storyforge" / "agent-instructions.md").write_text("Use a new point of view", encoding="utf-8")
    tool_dispatches = []
    if drift == "tool_policy":
        from app.domains.agent_runs import fs_tools
        from app.domains.agent_runs.loop import checkpoint_store

        # Change the current public ToolSpec projection, not the saved digest or its hash function.
        original_specs = checkpoint_store.list_loop_tool_specs()
        read_spec = next(spec for spec in original_specs if spec.name == "fs.read")
        assert read_spec.retry_safe is True
        changed_specs = tuple(
            replace(spec, retry_safe=False) if spec.name == "fs.read" else spec
            for spec in original_specs
        )
        monkeypatch.setattr(checkpoint_store, "list_loop_tool_specs", lambda: changed_specs)
        original_read = fs_tools.fs_read

        def counted_read(*args, **kwargs):
            tool_dispatches.append("fs.read")
            return original_read(*args, **kwargs)

        monkeypatch.setattr(fs_tools, "fs_read", counted_read)
    with Session(durable_engine) as reopened:
        completed_facts = [item.payload for item in service.list_agent_run_events(reopened, "durable-run")
                           if item.event_type == "tool_trace"]
        if drift == "permission":
            reopened.get(AgentRun, run_id).permission_profile = "read"
            reopened.commit()
        if drift == "checkpoint":
            from app.domains.agent_runs.loop.checkpoint_store import latest_checkpoint_artifact

            row = latest_checkpoint_artifact(reopened, reopened.get(AgentRun, run_id))
            row.payload = {**row.payload, "sha256": "invalid-latest-do-not-fall-back"}
            reopened.commit()
        control = service.handle_agent_control_message(reopened, public_id="durable-run",
                                                      session_id="durable-session", control_type="resume_run")
        if drift != "none":
            assert control.resumed_result is None
            expected = {"permission": "permission_snapshot_changed", "checkpoint": "checkpoint_digest_mismatch",
                        "tool_policy": "tool_policy_changed"}
            assert control.resume_diagnostic["reason"] == expected.get(drift, "source_version_changed")
            assert len(requests) == 1
            assert reopened.get(AgentRun, run_id).status == "paused"
            if drift == "tool_policy":
                assert control.resume_diagnostic["can_resume"] is False
                assert control.resume_diagnostic["resume_strategy"] == "reconciliation_required"
                assert tool_dispatches == []
                assert len(completed_facts) == 1
                assert [item.payload for item in service.list_agent_run_events(reopened, "durable-run")
                        if item.event_type == "tool_trace"] == completed_facts
                assert chapter.read_text(encoding="utf-8") == "original evidence"
            return
        assert control.resumed_result is not None
        assert control.resumed_result["agent_result"]["summary"] == "resumed answer"
        assert reopened.get(AgentRun, run_id).status == "completed"
        assert len(requests) == 2
        feedback = [m.content for m in requests[1].messages if m.tool_call_id == "read-1"]
        assert len(feedback) == 1 and "original evidence" in feedback[0]
        assert "different content" not in feedback[0]
        assert [trace["tool_name"] for trace in control.resumed_result["tool_trace"]] == ["fs.read"]


@pytest.mark.parametrize("native", [False, True])
@pytest.mark.parametrize("pause_stage", ["provider", "after_first_tool"])
def test_resume_unstarted_model_tool_batch_or_reconcile_native_state(durable_engine, tmp_path, monkeypatch, native, pause_stage):
    from sqlalchemy import select

    from app.domains.agent_runs.models import AgentArtifact
    from app.platform.ai_sdk import ProviderContinuation

    project = tmp_path / "batch"
    project.mkdir()
    (project / "one.md").write_text("one", encoding="utf-8")
    (project / "two.md").write_text("two", encoding="utf-8")
    requests = []

    class Provider:
        def complete(self, request):
            requests.append(request)
            if len(requests) == 1:
                if pause_stage == "provider":
                    pause()
                return ChatResponse("", tool_calls=(
                    ToolCall("one", "fs_read", '{"path":"one.md"}'),
                    ToolCall("two", "fs_read", '{"path":"two.md"}'),
                ), continuation=ProviderContinuation("native", {"opaque": "private-native-signature"}) if native else None)
            return ChatResponse("both read")

    def pause():
        with Session(durable_engine) as controller:
            service.record_agent_control_event(controller, public_id="batch-run", session_id="batch-session",
                                               control_type="pause_run")

    def pause_after_first(item):
        if pause_stage == "after_first_tool" and item.event_type == "tool_trace" and item.payload.get("index") == 0:
            pause()

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    with Session(durable_engine) as worker:
        first = service.run_agent_user_message(worker, agent_session_id="batch-session", message={
            "run_id": "batch-run", "user_message": "Read both", "intent": "chat.explain",
            "args": {"project_path": str(project)},
        }, on_event=pause_after_first)
        assert first.run.status == "paused"
        assert len(first.result["tool_trace"]) == (0 if pause_stage == "provider" else 1)
    durable_engine.dispose()
    with Session(durable_engine) as reopened:
        snapshots = list(reopened.scalars(select(AgentArtifact).where(AgentArtifact.kind == "runtime_checkpoint")))
        assert snapshots
        assert "private-native-signature" not in str([a.payload for a in snapshots])
        assert service.list_agent_artifacts(reopened, "batch-run") == []
        control = service.handle_agent_control_message(reopened, public_id="batch-run", session_id="batch-session",
                                                      control_type="resume_run")
        if native:
            assert control.resumed_result is None
            assert control.resume_diagnostic["reason"] == "provider_continuation_unavailable"
            assert len(requests) == 1
        else:
            assert control.resumed_result["agent_result"]["summary"] == "both read"
            assert len(requests) == 2
            assert [m.tool_call_id for m in requests[1].messages if m.tool_call_id] == ["one", "two"]
            traces = [e.payload["index"] for e in service.list_agent_run_events(reopened, "batch-run")
                      if e.event_type == "tool_trace"]
            assert traces == [0, 1]


@pytest.mark.parametrize("crash_stage", ["model", "tool"])
def test_startup_unknown_outcome_is_parked_without_replaying(durable_engine, tmp_path, monkeypatch, crash_stage):
    from sqlalchemy import select

    from app.domains.agent_runs.models import AgentArtifact

    class ProcessDied(BaseException):
        pass

    project = tmp_path / "unknown"
    project.mkdir()
    (project / "chapter.md").write_text("original", encoding="utf-8")
    attempts = []

    def crash_revision(*args, **kwargs):
        attempts.append("tool")
        raise ProcessDied()

    class Provider:
        def complete(self, request):
            attempts.append("model")
            if crash_stage == "model":
                with Session(durable_engine) as independent:
                    row = independent.scalar(select(AgentArtifact).where(AgentArtifact.kind == "runtime_checkpoint")
                                             .order_by(AgentArtifact.id.desc()).limit(1))
                    assert row.payload["dispatch_state"] == "model_outcome_unknown"
                raise ProcessDied()
            return ChatResponse("", tool_calls=(ToolCall("edit", "file_revise", '{"path":"chapter.md","instruction":"Revise"}'),))

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(assistant_service, "revise_file_content", crash_revision)
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    with Session(durable_engine) as worker, pytest.raises(ProcessDied):
        service.run_agent_user_message(worker, agent_session_id="unknown-session", message={
            "run_id": "unknown-run", "user_message": "Revise this", "intent": "chat.explain",
            "args": {"project_path": str(project)},
        })
    durable_engine.dispose()
    with Session(durable_engine) as reopened:
        assert service.reap_non_terminal_agent_runs(reopened) == 1
        run = service.get_agent_run(reopened, "unknown-run")
        assert run.status == "paused"
        assert run.current_step == "runtime.recovery"
        before = list(attempts)
        control = service.handle_agent_control_message(reopened, public_id="unknown-run", session_id="unknown-session",
                                                      control_type="resume_run")
        assert control.resumed_result is None
        assert control.resume_diagnostic["reason"] == ("model_outcome_unknown" if crash_stage == "model" else "tool_outcome_unknown")
        assert attempts == before
        assert (project / "chapter.md").read_text(encoding="utf-8") == "original"


@pytest.mark.parametrize("phase", ["model_completed", "after_tool"])
def test_startup_reopens_committed_safe_boundary_without_repeating_model_or_completed_tools(
    durable_engine, tmp_path, monkeypatch, phase,
):
    from app.domains.agent_runs.loop.checkpoint_store import StoryForgeCheckpointStore

    class ProcessDied(BaseException):
        pass

    project = tmp_path / "safe-crash"
    project.mkdir()
    (project / "chapter.md").write_text("saved fact", encoding="utf-8")
    requests = []
    saved = []
    original_save = StoryForgeCheckpointStore.save

    def crash_after_commit(store, checkpoint):
        original_save(store, checkpoint)
        if checkpoint.phase.value == phase and not saved:
            saved.append(checkpoint)
            raise ProcessDied()

    class Provider:
        def complete(self, request):
            requests.append(request)
            if len(requests) == 1:
                return ChatResponse("", tool_calls=(ToolCall("read", "fs_read", '{"path":"chapter.md"}'),))
            return ChatResponse("safe resume")

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    monkeypatch.setattr(StoryForgeCheckpointStore, "save", crash_after_commit)
    with Session(durable_engine) as worker, pytest.raises(ProcessDied):
        service.run_agent_user_message(worker, agent_session_id="safe-session", message={
            "run_id": "safe-run", "user_message": "Read this", "intent": "chat.explain",
            "args": {"project_path": str(project)},
        })
    assert len(requests) == 1
    durable_engine.dispose()
    with Session(durable_engine) as restarted:
        assert service.reap_non_terminal_agent_runs(restarted) == 1
        from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event

        parked = service.list_agent_run_events(restarted, "safe-run")[-1]
        assert parked.event_type == "agent_run_interrupted"
        frames = websocket_stream_events_from_agent_event(parked)
        assert frames[0]["status"] == "paused"
        replayed = frames[0]["payload"]["execution_result"]
        assert replayed["runtime_interruption"]["status"] == "paused"
        assert replayed["proposed_patch"] is None
        assert replayed["runtime_recovery"]["can_resume"] is True
        projection = service.get_agent_run_save_points(restarted, "safe-run")
        assert projection["recoverability"]["can_resume"] is True
        assert projection["recoverability"]["resume_strategy"] == "continue_checkpoint"
        control = service.handle_agent_control_message(restarted, public_id="safe-run", session_id="safe-session",
                                                      control_type="resume_run")
        assert control.resumed_result["agent_result"]["summary"] == "safe resume"
        assert len(requests) == 2
        assert [m.tool_call_id for m in requests[1].messages if m.tool_call_id] == ["read"]
        events = service.list_agent_run_events(restarted, "safe-run")
        assert len([e for e in events if e.event_type == "tool_trace"]) == 1
        assert service.get_agent_run(restarted, "safe-run").status == "completed"


def test_concurrent_resume_controls_claim_one_worker(durable_engine, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, local

    from app.domains.agent_runs import service_control

    with Session(durable_engine) as session:
        run = service.create_or_resume_agent_run(session, public_id="claim-run", session_id="claim-session", goal="resume")
        run.status = "paused"
        run.current_step = "paused"
        session.commit()
    barrier = Barrier(2)
    thread = local()
    original = service_control.agent_execution_state

    def synchronize_stale_read(session, run):
        result = original(session, run)
        thread.checks = getattr(thread, "checks", 0) + 1
        if thread.checks == 2:
            barrier.wait(timeout=5)
        return result

    monkeypatch.setattr(service_control, "agent_execution_state", synchronize_stale_read)

    def resume():
        with Session(durable_engine) as session:
            event = service.record_agent_control_event(session, public_id="claim-run", session_id="claim-session",
                                                       control_type="resume_run")
            return event.payload["control_effect"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        effects = list(executor.map(lambda _: resume(), range(2)))
    assert sorted(effects) == ["applied", "ignored"]


@pytest.mark.parametrize("patch", [False, True])
def test_resume_preserves_known_reply_or_pending_patch_without_regeneration(durable_engine, tmp_path, monkeypatch, patch):
    from app.domains.assistant.schemas import AssistantReviseResponse

    project = tmp_path / "pending-result"
    project.mkdir()
    chapter = project / "chapter.md"
    chapter.write_text("original", encoding="utf-8")
    requests = []
    revisions = []

    def pause():
        with Session(durable_engine) as controller:
            service.record_agent_control_event(controller, public_id="result-run", session_id="result-session",
                                               control_type="pause_run")

    def revise(session, request, *, author_instruction=None, prepared_context=None):
        assert author_instruction == "Help with this"
        assert prepared_context is not None and prepared_context.context_bundle == request.context_bundle
        revisions.append(request)
        return AssistantReviseResponse(before=request.content, after="revised", summary="a retained patch",
                                       model="fake", latency_ms=1, completion_tokens=3,
                                       assistant_session_id=request.assistant_session_id)

    class Provider:
        def complete(self, request):
            requests.append(request)
            if patch and len(requests) == 1:
                return ChatResponse("", tool_calls=(ToolCall("revise", "file_revise",
                    '{"path":"chapter.md","instruction":"Revise"}'),))
            if not patch:
                pause()
            return ChatResponse("known answer")

    def pause_after_patch(item):
        if item.event_type == "tool_trace" and item.payload.get("trace", {}).get("tool_name") == "file.revise":
            pause()

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(assistant_service, "revise_file_content", revise)
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    with Session(durable_engine) as worker:
        initial = service.run_agent_user_message(worker, agent_session_id="result-session", message={
            "run_id": "result-run", "user_message": "Help with this", "intent": "chat.explain",
            "permission_profile": "auto", "args": {"project_path": str(project)},
        }, on_event=pause_after_patch)
        assert initial.run.status == "paused"
        assert initial.result["proposed_patch"] is None
    durable_engine.dispose()
    with Session(durable_engine) as restarted:
        control = service.handle_agent_control_message(restarted, public_id="result-run", session_id="result-session",
                                                      control_type="resume_run")
        assert control.resumed_result["agent_result"]["summary"] == "known answer"
        assert len(requests) == (2 if patch else 1)
        assert len(revisions) == (1 if patch else 0)
        if patch:
            assert control.resumed_result["proposed_patch"]["after"] == "revised"
            assert control.resumed_result["proposed_patch"]["requires_confirmation"] is True
            artifacts = service.list_agent_artifacts(restarted, "result-run")
            proposal = next(artifact for artifact in artifacts if artifact.kind == "proposed_patch")
            assert proposal.requires_confirmation is True
            assert service.get_agent_run(restarted, "result-run").current_step == "permission.confirm"
            ignored = service.handle_agent_control_message(restarted, public_id="result-run", session_id="result-session",
                                                          control_type="resume_run")
            assert ignored.event.payload["control_effect"] == "ignored"
            assert len(requests) == 2
        else:
            assert service.get_agent_run(restarted, "result-run").status == "completed"
        assert chapter.read_text(encoding="utf-8") == "original"
