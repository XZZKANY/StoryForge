from __future__ import annotations

import json

import pytest
from agent_external_chat_test_support import engine as engine
from agent_external_chat_test_support import lease, live_setup
from agent_external_writeback_test_support import AFTER, BEFORE, identity, ledger
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.loop.external_wait_lifecycle import claim_external_execution
from app.domains.agent_runs.loop.external_wait_store import read_external_wait
from app.domains.agent_runs.loop.external_writeback import prepare_external_writeback, reconcile_external_writeback
from app.domains.agent_runs.models import AgentArtifact, AgentRunEvent
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantMessage, AssistantToolCall
from app.domains.assistant.schemas import AssistantReviseResponse
from app.platform.ai_sdk import ChatResponse, MessageRole, ToolCall


def test_production_chat_waits_before_read_and_legacy_delivery(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        emitted = []
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease(), on_event=emitted.append)
        saved = read_external_wait(session, run)
        assert result["type"] == "agent_run_waiting"
        assert result["wait_id"] == saved.wait.wait_id
        assert "agent_result" not in result and "proposed_patch" not in result
        assert run.status == "paused" and run.current_step == saved.wait.token
        assert len(provider.requests) == len(revisions) == 1
        assert revisions[0].content == BEFORE.replace("\r\n", "\n")
        assert saved.wait.raw_before.encode() == (root / "chapter.md").read_bytes() == BEFORE.encode()
        assert saved.prepared.checkpoint.pending.call_id == "revise"
        assert not saved.wait.feedback_consumed
        assert session.scalar(select(AssistantToolCall).where(AssistantToolCall.tool_name == "file.revise")).status == "running"
        assert session.scalar(select(AssistantMessage.id)) is None
        assert not session.scalar(select(AgentArtifact.id).where(AgentArtifact.kind == "proposed_patch"))
        assert not {"permission_required", "agent_run_completed", "system_job"}.intersection(e.event_type for e in emitted)
        assert [e.event_type for e in emitted].count("agent_writeback_waiting") == 1


def test_production_same_run_resume_reuses_owner_reads_disk_and_never_regenerates(engine, tmp_path, monkeypatch):
    from app.domains.agent_runs.loop.external_chat import external_control_context

    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                               message=message, external_lease=lease())
        current = read_external_wait(session, run)
        ctx = external_control_context(session, run)
        current = prepare_external_writeback(ctx, wait_id=current.wait.wait_id, expected_revision=current.wait.revision,
                                             identity=identity(current.wait), decision="approve", permission_profile="ask")
        ledger(current.wait)  # Synthetic fixture, not a Native writer/GUI acceptance claim.
        current = reconcile_external_writeback(ctx, wait_id=current.wait.wait_id, expected_revision=current.wait.revision)
        claimed = claim_external_execution(session, run, wait_id=current.wait.wait_id, expected_revision=current.wait.revision,
                                           execution_epoch="live-epoch", delivery_complete=True)
        started = session.scalar(select(AgentRunEvent).where(AgentRunEvent.event_type == "agent_execution_started")
                                 .order_by(AgentRunEvent.sequence.desc()).limit(1))

        def no_rebuild(*args, **kwargs):
            raise AssertionError("resume must use frozen messages, not rebuild history/context")

        monkeypatch.setattr(loop_runtime, "_storyforge_messages", no_rebuild)
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease(), started_event=started)
        assert result["type"] == "agent_result" and result["run_id"] == "live-run"
        assert run.status == "completed" and len(provider.requests) == 2 and len(revisions) == 1
        assert result["proposed_patch"] is None
        feedback = [m for m in provider.requests[-1].messages if m.role is MessageRole.TOOL]
        assert [m.tool_call_id for m in feedback] == ["revise", "read"]
        assert json.loads(feedback[0].content)["applied"] is True
        assert json.loads(feedback[1].content)["content"] == (root / "chapter.md").read_bytes().decode() == AFTER
        assert session.query(AgentRunEvent).filter_by(event_type="agent_execution_started").count() == 2
        assert session.query(AssistantToolCall).filter_by(tool_name="file.revise").count() == 1
        assert session.query(AssistantMessage).count() == 2
        latest = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "runtime_checkpoint")
                                .order_by(AgentArtifact.id.desc()).limit(1))
        assert latest.payload["version"] == 2 and latest.payload["write_budget_used"] == 1
        assert latest.payload["external_wait"]["historical_applied"] is True
        assert latest.payload["checkpoint"]["phase"] == "completed"
        assert latest.payload["active_elapsed_seconds"] >= claimed.prepared.payload["active_elapsed_seconds"]


def test_new_wait_cannot_be_replayed_via_legacy_user_message(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                               message=message, external_lease=lease())
        current = read_external_wait(session, run)
        count = session.query(AgentRunEvent).count()
        with pytest.raises(service.AgentRuntimeError, match="cannot_replay"):
            service.start_agent_user_message_run(session, agent_session_id=run.session_id, message=message)
        assert read_external_wait(session, run).wait == current.wait
        assert session.query(AgentRunEvent).count() == count and len(provider.requests) == 1


def test_raw_input_drift_during_generation_never_publishes_or_leaks_legacy_patch(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)

        def revise_and_drift(session, request, *, author_instruction=None, prepared_context=None):
            (root / "chapter.md").write_bytes(b"author edit")
            return AssistantReviseResponse(before=request.content, after=AFTER, summary="revision", model="fake",
                                           latency_ms=1, completion_tokens=3,
                                           assistant_session_id=request.assistant_session_id)

        monkeypatch.setattr(assistant_service, "revise_file_content", revise_and_drift)
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease())
        assert result["type"] == "agent_result" and run.status == "failed"
        assert result["proposed_patch"] is None
        assert (root / "chapter.md").read_bytes() == b"author edit" and len(provider.requests) == 1
        assert not session.query(AgentRunEvent).filter_by(event_type="agent_writeback_waiting").count()
        assert not session.query(AgentArtifact).filter_by(kind="proposed_patch").count()


def test_unserializable_continuation_never_publishes_new_wait(engine, tmp_path, monkeypatch):
    from app.platform.ai_sdk import ProviderContinuation

    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch, responses=[
            ChatResponse("", tool_calls=(ToolCall("revise", "file_revise", '{"path":"chapter.md","instruction":"Revise"}'),),
                         continuation=ProviderContinuation("test", {"signature": "opaque"})),
        ])
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease())
        assert result["type"] == "agent_result" and run.status == "failed"
        assert result["proposed_patch"] is None and (root / "chapter.md").read_bytes() == BEFORE.encode()
        assert not session.query(AgentRunEvent).filter_by(event_type="agent_writeback_waiting").count()


def test_receipt_before_second_sdk_save_survives_without_running_rest_of_batch(engine, tmp_path, monkeypatch):
    from app.domains.agent_runs.loop import external_checkpoint

    publish = external_checkpoint.publish_external_wait
    consumed = []

    def publish_and_receive(context, checkpoint, **kwargs):
        current = publish(context, checkpoint, **kwargs)
        current = prepare_external_writeback(context, wait_id=current.wait.wait_id, expected_revision=current.wait.revision,
                                             identity=identity(current.wait), decision="approve", permission_profile="ask")
        ledger(current.wait)
        current = reconcile_external_writeback(context, wait_id=current.wait.wait_id, expected_revision=current.wait.revision)
        consumed.append(current)
        with pytest.raises(ValueError, match="not_ready"):
            claim_external_execution(context.session, context.run, wait_id=current.wait.wait_id,
                                     expected_revision=current.wait.revision, execution_epoch="live-epoch", delivery_complete=True)
        return current

    monkeypatch.setattr(external_checkpoint, "publish_external_wait", publish_and_receive)
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease())
        saved = read_external_wait(session, run)
        assert result["type"] == "agent_run_waiting" and saved.wait.stage == "receipt_ready"
        assert saved.prepared.checkpoint == consumed[0].prepared.checkpoint
        assert len(provider.requests) == len(revisions) == 1
        assert saved.wait.feedback_consumed and (root / "chapter.md").read_bytes() == AFTER.encode()


def test_pause_after_publication_retains_wait_without_false_legacy_terminal(engine, tmp_path, monkeypatch):
    from app.domains.agent_runs.loop import external_checkpoint

    publish = external_checkpoint.publish_external_wait

    def publish_and_pause(context, checkpoint, **kwargs):
        current = publish(context, checkpoint, **kwargs)
        service.record_agent_control_event(context.session, public_id=context.run.public_id,
                                           session_id=context.run.session_id, control_type="pause_run")
        return current

    monkeypatch.setattr(external_checkpoint, "publish_external_wait", publish_and_pause)
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease())
        saved = read_external_wait(session, run)
        assert result["type"] == "agent_run_waiting" and saved.wait.execution_epoch is None
        assert run.status == "paused" and (root / "chapter.md").read_bytes() == BEFORE.encode()
        assert not session.query(AgentRunEvent).filter_by(event_type="agent_run_interrupted").count()
        assert not session.query(AssistantMessage).count()



def ready_segment(session, run):
    from app.domains.agent_runs.loop.external_chat import external_control_context

    current = read_external_wait(session, run)
    context = external_control_context(session, run)
    current = prepare_external_writeback(context, wait_id=current.wait.wait_id, expected_revision=current.wait.revision,
                                         identity=identity(current.wait), decision="approve", permission_profile="ask")
    ledger(current.wait)
    current = reconcile_external_writeback(context, wait_id=current.wait.wait_id, expected_revision=current.wait.revision)
    claim_external_execution(session, run, wait_id=current.wait.wait_id, expected_revision=current.wait.revision,
                             execution_epoch="live-epoch", delivery_complete=True)
    return session.scalar(select(AgentRunEvent).where(AgentRunEvent.event_type == "agent_execution_started")
                          .order_by(AgentRunEvent.sequence.desc()).limit(1))


def test_source_drift_between_claim_and_resume_parks_facts_without_provider_or_legacy_delivery(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                               message=message, external_lease=lease())
        started = ready_segment(session, run)
        (root / "chapter.md").write_bytes(b"later author edit")
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease(), started_event=started)
        assert result["type"] == "agent_run_waiting" and len(provider.requests) == 1
        current = read_external_wait(session, run)
        assert current.wait.historical_applied and current.wait.execution_epoch is None
        assert (root / "chapter.md").read_bytes() == b"later author edit" and run.status == "paused"
        assert not session.query(AssistantMessage).count()


def test_active_budget_is_not_reset_for_resumed_segment(engine, tmp_path, monkeypatch):
    from app.domains.agent_runs.loop.checkpoint_store import payload_digest

    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                               message=message, external_lease=lease())
        started = ready_segment(session, run)
        artifact = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "runtime_checkpoint")
                                  .order_by(AgentArtifact.id.desc()).limit(1))
        payload = {**artifact.payload, "active_elapsed_seconds": 900.0}
        payload["sha256"] = payload_digest(payload)
        artifact.payload = payload
        session.commit()
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease(), started_event=started)
        assert len(provider.requests) == 1 and len(revisions) == 1
        assert result["agent_result"]["execution_outcome"]["code"] == "runtime_deadline"
        assert run.status == "failed" and (root / "chapter.md").read_bytes() == AFTER.encode()
        assert session.query(AssistantToolCall).filter_by(tool_name="fs.read").count() == 0


def test_second_write_in_same_batch_stays_blocked_after_hidden_proposal_consumption(engine, tmp_path, monkeypatch):
    responses = [ChatResponse("", tool_calls=(
        ToolCall("revise", "file_revise", '{"path":"chapter.md","instruction":"Revise"}'),
        ToolCall("read", "fs_read", '{"path":"chapter.md"}'),
        ToolCall("second", "file_revise", '{"path":"chapter.md","instruction":"Again"}'),
    )), ChatResponse("checked")]
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch, responses=responses)
        service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                               message=message, external_lease=lease())
        started = ready_segment(session, run)
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease(), started_event=started)
        assert run.status == "completed" and len(revisions) == 1 and result["proposed_patch"] is None
        tool_feedback = [m for m in provider.requests[-1].messages if m.tool_call_id == "second"]
        assert len(tool_feedback) == 1 and "最多生成一个" in json.loads(tool_feedback[0].content)["error"]
        assert "file_revise" not in {tool.name for tool in provider.requests[-1].tools}


def test_cancel_audit_committed_before_publication_cannot_publish_executable_wait(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        revise = assistant_service.revise_file_content

        def revise_after_cancel_audit(session, request, *, author_instruction=None, prepared_context=None):
            service.record_agent_event(session, run, event_type="pause_run", actor="author",
                                       payload={"session_id": run.session_id, "run_id": run.public_id})
            return revise(session, request, author_instruction=author_instruction, prepared_context=prepared_context)

        monkeypatch.setattr(assistant_service, "revise_file_content", revise_after_cancel_audit)
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease())
        assert result["type"] != "agent_run_waiting" and result["proposed_patch"] is None
        assert not session.query(AgentRunEvent).filter_by(event_type="agent_writeback_waiting").count()
        assert (root / "chapter.md").read_bytes() == BEFORE.encode() and len(provider.requests) == 1


def test_source_changes_after_load_but_before_dispatch_parks_without_read_or_model(engine, tmp_path, monkeypatch):
    from app.domains.agent_runs.loop.external_checkpoint import ExternalChatCheckpointStore

    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                               message=message, external_lease=lease())
        started = ready_segment(session, run)
        original = ExternalChatCheckpointStore.load

        def load_then_author_edit(self, run_id):
            checkpoint = original(self, run_id)
            (root / "chapter.md").write_bytes(b"author edit after load")
            return checkpoint

        monkeypatch.setattr(ExternalChatCheckpointStore, "load", load_then_author_edit)
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease(), started_event=started)
        current = read_external_wait(session, run)
        assert result["type"] == "agent_run_waiting" and current.wait.execution_epoch is None
        assert current.wait.historical_applied and len(provider.requests) == 1 and len(revisions) == 1
        assert not session.query(AssistantToolCall).filter_by(tool_name="fs.read").count()
        assert (root / "chapter.md").read_bytes() == b"author edit after load"
        assert not session.query(AssistantMessage).count()


def test_provider_settings_drift_parks_without_dispatch_and_never_persists_keys(engine, tmp_path, monkeypatch):
    with Session(engine) as session:
        run, message, root, provider, revisions = live_setup(session, tmp_path, monkeypatch)
        service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                               message=message, external_lease=lease())
        started = ready_segment(session, run)
        monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {
            "STORYFORGE_LLM_MODEL": "other-model", "STORYFORGE_LLM_API_KEY": "private-key-never-in-db",
        })
        result = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                                       message=message, external_lease=lease(), started_event=started)
        assert result["type"] == "agent_run_waiting" and len(provider.requests) == 1
        assert read_external_wait(session, run).wait.execution_epoch is None
        payloads = [artifact.payload for artifact in session.query(AgentArtifact)]
        assert "private-key-never-in-db" not in json.dumps(payloads)
