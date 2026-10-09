"""Private resumable calls must not be copied into public event history or SSE."""

from __future__ import annotations

import json
from copy import deepcopy

import pytest
from agent_run_test_support import _seed_agent_run, _stored_run_events
from sqlalchemy import select

from app.domains.agent_runs.event_encoders import encode_agent_run_sse_event
from app.domains.agent_runs.models import AgentArtifact
from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
from app.domains.agent_runs.schemas import AgentRunEventRead
from app.domains.agent_runs.service_store import record_agent_artifact


def private_pending(intent="chapter.write", status="pending"):
    return {
        "kind": RUNTIME_PENDING_CALL_ARTIFACT_KIND,
        "intent": intent,
        "status": status,
        "boundary": "after_tool:chapter.brief",
        "resume_strategy": "continue_chapter_writing_after_brief",
        "resume_message": {
            "type": "user_message",
            "intent": intent,
            "args": {
                "project_path": "/private/novel/project",
                "file_path": "正文/第001章.md",
                "context_bundle": {"files": [{"excerpt": "PRIVATE_CONTEXT_SENTINEL"}]},
            },
        },
        "source_guard": {"internal_fact": "PRIVATE_SOURCE_GUARD"},
        "chapter_brief": {"goal": "PRIVATE_BRIEF_BODY"},
    }


def assert_public_only(value):
    text = json.dumps(value, ensure_ascii=False)
    for private in (
        "/private/novel/project",
        "PRIVATE_CONTEXT_SENTINEL",
        "PRIVATE_SOURCE_GUARD",
        "PRIVATE_BRIEF_BODY",
        "resume_message",
    ):
        assert private not in text


@pytest.mark.parametrize("intent", ["chapter.write", "file.review", "chapter.review"])
def test_persisted_pending_event_has_only_summary_but_private_artifact_is_unchanged(session, intent):
    run = _seed_agent_run(session)
    body = private_pending(intent)
    artifact = record_agent_artifact(session, run, kind=RUNTIME_PENDING_CALL_ARTIFACT_KIND, payload=body)
    session.expire_all()
    stored = session.get(AgentArtifact, artifact.id)
    assert stored.payload == body
    event = _stored_run_events(session, run)[-1]
    assert_public_only(event.payload)
    assert event.payload["artifact_id"] == artifact.id
    assert event.payload["payload"]["intent"] == intent
    assert event.payload["payload"]["status"] == "pending"


@pytest.mark.parametrize("status", ["pending", "resolved", None])
def test_legacy_pending_events_are_safely_projected_on_rest_and_sse_without_rewriting_private_rows(
    client, session, status
):
    run = _seed_agent_run(session, public_id="legacy-private-boundary")
    body = private_pending(status=status)
    artifact = record_agent_artifact(session, run, kind=RUNTIME_PENDING_CALL_ARTIFACT_KIND, payload=body)
    event = _stored_run_events(session, run)[-1]
    # Simulate an existing database row from before the boundary fix.
    legacy = {
        "artifact_id": artifact.id,
        "kind": RUNTIME_PENDING_CALL_ARTIFACT_KIND,
        "requires_confirmation": False,
        "payload": body,
    }
    event.payload = deepcopy(legacy)
    session.add(event)
    session.commit()
    session.refresh(event)
    original = deepcopy(event.payload)
    response = client.get(f"/api/agent-runs/{run.public_id}/events")
    assert response.status_code == 200
    assert_public_only(response.json())
    wire = encode_agent_run_sse_event(event)
    assert_public_only(wire)
    assert f'"artifact_id": {artifact.id}' in wire
    safe = AgentRunEventRead.model_validate(event).model_dump(mode="json")
    assert_public_only(safe)
    # Projecting a summary twice is safe and preserves usable public metadata.
    assert AgentRunEventRead.model_validate(safe).model_dump(mode="json") == safe
    session.expire_all()
    assert session.get(AgentArtifact, artifact.id).payload == body
    assert _stored_run_events(session, run)[-1].payload == original
    public_artifacts = client.get(f"/api/agent-runs/{run.public_id}/artifacts")
    assert public_artifacts.status_code == 200 and public_artifacts.json() == []


def test_visible_proposal_body_is_not_removed_by_private_pending_projection(session):
    run = _seed_agent_run(session)
    body = {"kind": "file_revision", "before": "旧稿", "after": "新稿", "file_path": "正文.md"}
    record_agent_artifact(session, run, kind="proposed_patch", payload=body, requires_confirmation=True)
    event = _stored_run_events(session, run)[-1]
    assert event.payload["payload"] == body
    assert AgentRunEventRead.model_validate(event).model_dump()["payload"]["payload"] == body


@pytest.mark.parametrize("drift", ["none", "target", "context"])
def test_reloaded_brief_uses_private_binding_and_refuses_stale_sources_without_writing(tmp_path, monkeypatch, drift):
    from chapter_check_test_support import chapter_check_reply
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import NullPool
    from test_chapter_brief_source_binding import begin

    from app.db.base import Base
    from app.domains.agent_runs.service import handle_agent_control_message
    from app.domains.agent_runs.service_types import AgentRuntimeError
    from app.domains.assistant import service as assistant_service
    from app.domains.assistant.schemas import AssistantDraftResponse

    project = tmp_path / "original-project"
    project.mkdir()
    target = project / "第001章.md"
    target.write_text("")
    source = project / "setting.txt"
    source.write_text("门锁只能由铜钥匙开启。")
    foreign = tmp_path / "other-project"
    foreign.mkdir()
    other = foreign / target.name
    other.write_text("FOREIGN_UNTOUCHED")
    database = f"sqlite+pysqlite:///{tmp_path / 'resume.sqlite3'}"
    engine = create_engine(database, poolclass=NullPool)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(assistant_service, "chat_reply", lambda *_a, **_kw: {"reply": '{"goal":"建立冲突"}'})
    with Session(engine) as first:
        run, initial = begin(
            first,
            project,
            target,
            {"project_root": str(project), "files": [{"relative_path": "setting.txt", "kind": "setting"}]},
        )
        pending = first.scalars(
            select(AgentArtifact).where(AgentArtifact.kind == RUNTIME_PENDING_CALL_ARTIFACT_KIND)
        ).one()
        private = deepcopy(pending.payload)
        artifact_id = pending.id
        assert private["resume_message"]["args"]["project_path"] == str(project)
        brief = initial["agent_result"]["chapter_brief"]
        public_id, session_id = run.public_id, run.session_id
    engine.dispose()
    if drift == "target":
        target.write_text("作者刚修改的正文。")
    if drift == "context":
        source.write_text("门锁现在只能由银钥匙开启。")
    before = target.read_bytes()
    calls = []

    def draft(_session, request, **_kwargs):
        calls.append(request)
        assert request.project_root == str(project)
        return AssistantDraftResponse(
            content="一" * 1800,
            summary="草稿",
            model="controlled-fixture",
            latency_ms=0,
            completion_tokens=0,
            assistant_session_id=1,
        )

    monkeypatch.setattr(assistant_service, "draft_file_content", draft)
    monkeypatch.setattr(
        assistant_service, "chat_reply", lambda _session, **kw: chapter_check_reply(kw["user_message"], [])
    )
    reloaded = create_engine(database, poolclass=NullPool)
    try:
        with Session(reloaded) as session:
            control = {"chapter_brief": brief, "args": {"project_path": str(foreign)}}
            if drift != "none":
                with pytest.raises(AgentRuntimeError):
                    handle_agent_control_message(
                        session, public_id=public_id, session_id=session_id, control_type="resume_run", payload=control
                    )
                assert calls == []
            else:
                result = handle_agent_control_message(
                    session, public_id=public_id, session_id=session_id, control_type="resume_run", payload=control
                ).resumed_result
                assert result is not None and result["proposed_patch"]["requires_confirmation"] is True
                assert result["proposed_patch"]["before"] == "" and result["proposed_patch"]["after"] == "一" * 1800
                assert len(calls) == 1
                handle_agent_control_message(
                    session, public_id=public_id, session_id=session_id, control_type="resume_run", payload=control
                )
                assert len(calls) == 1, "Repeated resume must not regenerate the already-proposed chapter."
            assert session.get(AgentArtifact, artifact_id).payload == private
    finally:
        reloaded.dispose()
    assert target.read_bytes() == before
    assert other.read_text() == "FOREIGN_UNTOUCHED"
