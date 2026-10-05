from __future__ import annotations

import json

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import control_agent, stream_agent_message
from compaction_test_support import SummaryProvider, persist_checkpoint, seed_history
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.domains.agent_runs import compaction_job, service
from app.domains.agent_runs.event_sink import AgentRunEventSink
from app.domains.agent_runs.loop.support import history_messages
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.assistant.models import AssistantMessage, AssistantToolCall

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


@pytest.fixture()
def engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'compaction.sqlite'}", poolclass=NullPool,
                           connect_args={"check_same_thread": False, "timeout": 3})
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    yield engine
    engine.dispose()


def park_patch(session: Session, run: AgentRun) -> None:
    run.status = "paused"
    run.current_step = "permission.confirm"
    session.commit()
    service.record_agent_event(session, run, event_type="permission_required", actor="permission-gate", payload={
        "assistant_session_id": run.assistant_session_id, "requires_user_confirmation": True,
        "proposed_patch": {"id": "pending-patch", "file_path": "chapter.md", "status": "proposed"},
    })


def overlay(session: Session, conversation_id: int) -> dict:
    return json.loads(history_messages(session, conversation_id)[-1]["content"].split("\n", 1)[1])


@pytest.mark.parametrize("first,late,expected", [
    ("deny_permission", "approve_permission", "denied"),
    ("approve_permission", "deny_permission", "approved"),
])
def test_real_ignored_permission_control_cannot_change_compaction_overlay(
    session, client, first, late, expected,
):
    conversation, run = seed_history(session)
    park_patch(session, run)
    persist_checkpoint(session, conversation, run)
    first_ack = control_agent(client, run.session_id, control_type=first, run_id=run.public_id)
    assert first_ack["control_effect"] == "applied"
    late_ack = control_agent(client, run.session_id, control_type=late, run_id=run.public_id)
    assert late_ack["control_effect"] == "ignored"
    permission = overlay(session, conversation.id)["permission_by_run"][str(run.id)]
    assert permission["permission"] == expected
    assert permission["writeback"] == "unverified"


def test_real_stop_revokes_pending_patch_in_history_projection(session, client):
    conversation, run = seed_history(session)
    park_patch(session, run)
    persist_checkpoint(session, conversation, run)
    ack = control_agent(client, run.session_id, control_type="stop_run", run_id=run.public_id)
    assert ack["control_effect"] == "applied"
    permission = overlay(session, conversation.id)["permission_by_run"][str(run.id)]
    assert permission["permission"] == "cancelled"
    assert permission["pending_patch_available"] is False
    assert session.scalar(select(AgentRunEvent).where(
        AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == "agent_run_interrupted",
    )) is not None


def test_legacy_permission_without_transition_evidence_is_not_accepted(session):
    conversation, run = seed_history(session)
    park_patch(session, run)
    service.record_agent_event(session, run, event_type="permission_approved", actor="author", payload={})
    assert overlay(session, conversation.id)["permission_by_run"][str(run.id)]["permission"] == "required"
    service.record_agent_event(session, run, event_type="agent_run_completed", actor="root-agent", payload={
        "control_type": "approve_permission",
    })
    assert overlay(session, conversation.id)["permission_by_run"][str(run.id)]["permission"] == "approved"


def test_sse_repeated_compaction_and_rejection_preserve_far_author_constraint(
    session, client, monkeypatch, novel_project,
):
    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, [{"content": "仅分析，未写盘", "finish_reason": "stop"}])
    provider = SummaryProvider()
    monkeypatch.setattr(compaction_job, "build_llm_provider", lambda source: provider)
    conversation, parked = seed_history(session, project_path=str(novel_project))
    conversation.messages[0].content = "背景" * 2100 + "第4001字之后的硬约束：绝不能杀死林岚。"
    session.commit()
    park_patch(session, parked)
    for index in range(3):
        if index == 1:
            ack = control_agent(client, parked.session_id, control_type="deny_permission", run_id=parked.public_id)
            assert ack["control_effect"] == "applied"
        frames = stream_agent_message(
            client, "long-fidelity", run_id=f"fidelity-{index}", assistant_session_id=conversation.id,
            user_message="继续分析，保留全部作者约束。", args={"project_path": str(novel_project)},
        )
        assert frames[-1]["type"] == "agent_result"
        assert frames[-1]["system_jobs"]["compaction"]["status"] == "completed"
    assert len(provider.requests) == 3
    for request in calls:
        assert "第4001字之后的硬约束：绝不能杀死林岚。" in json.dumps(request["messages"], ensure_ascii=False)
    for request in calls[1:]:
        decision = next(message for message in request["messages"] if "最新证据覆盖历史摘要" in message["content"])
        assert json.loads(decision["content"].split("\n", 1)[1])["permission_by_run"][str(parked.id)]["permission"] == "denied"
    checkpoints = session.scalars(select(AgentArtifact).where(
        AgentArtifact.kind == "system_compaction",
    ).order_by(AgentArtifact.id)).all()
    assert len(checkpoints) == 3
    assert checkpoints[-1].payload["parent"]["artifact_id"] == checkpoints[-2].id
    assert len(session.scalars(select(AssistantMessage)).all()) == 22


def test_sse_cancel_during_hidden_summary_preserves_chat_and_usage_without_success(
    session, client, monkeypatch, novel_project,
):
    _enable_loop_env(monkeypatch)
    _fake_llm_script(monkeypatch, [{"content": "已经完成的聊天事实", "finish_reason": "stop", "prompt_tokens": 40}])
    conversation, _ = seed_history(session, project_path=str(novel_project))
    acknowledgements = []

    class CancelProvider(SummaryProvider):
        def complete(self, request):
            response = super().complete(request)
            acknowledgements.append(control_agent(client, "late-summary", control_type="stop_run", run_id="late-summary"))
            return response

    monkeypatch.setattr(compaction_job, "build_llm_provider", lambda source: CancelProvider())
    frames = stream_agent_message(
        client, "late-summary", run_id="late-summary", assistant_session_id=conversation.id,
        user_message="继续", args={"project_path": str(novel_project)},
    )
    assert acknowledgements[0]["control_effect"] == "requested"
    assert frames[-1]["runtime_interruption"]["status"] == "stopped"
    assert frames[-1]["proposed_patch"] is None
    assert session.scalar(select(AssistantMessage).where(AssistantMessage.content == "已经完成的聊天事实")) is not None
    usage = session.scalar(select(AssistantToolCall).where(AssistantToolCall.tool_name == "conversation.compact"))
    assert usage.output_summary["prompt_tokens"] == 100
    assert session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "system_compaction")) is None
    run = service.get_agent_run(session, "late-summary")
    events = session.scalars(select(AgentRunEvent).where(AgentRunEvent.run_id == run.id)).all()
    assert not any(event.event_type == "agent_run_completed" for event in events)
    assert any(event.event_type == "agent_run_interrupted" for event in events)


def test_independent_source_change_between_summary_and_publish_rejects_artifact(
    session, session_factory, client, monkeypatch, novel_project,
):
    _enable_loop_env(monkeypatch)
    _fake_llm_script(monkeypatch, [{"content": "正常完成", "finish_reason": "stop"}])
    monkeypatch.setattr(compaction_job, "build_llm_provider", lambda source: SummaryProvider())
    conversation, _ = seed_history(session, project_path=str(novel_project))
    message_id = conversation.messages[0].id
    original = AgentRunEventSink.record_system_job
    connections = []

    def edit_after_display_summary(self, run, **kwargs):
        original(self, run, **kwargs)
        if kwargs["key"] == "summary":
            with session_factory() as writer:
                connections.append(writer.connection().connection.dbapi_connection)
                message = writer.get(AssistantMessage, message_id)
                message.content = "新作者决定：保留第一版，不接受第二版。"
                writer.commit()

    monkeypatch.setattr(AgentRunEventSink, "record_system_job", edit_after_display_summary)
    frames = stream_agent_message(
        client, "publish-race", run_id="publish-race", assistant_session_id=conversation.id,
        user_message="继续", args={"project_path": str(novel_project)},
    )
    assert connections
    assert frames[-1]["type"] == "agent_result"
    assert frames[-1]["system_jobs"]["compaction"]["status"] == "failed"
    assert frames[-1]["system_jobs"]["compaction"]["code"] == "source_drift"
    assert session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "system_compaction")) is None
    assert history_messages(session, conversation.id)[0]["content"] == "新作者决定：保留第一版，不接受第二版。"
