from __future__ import annotations

from agent_run_test_support import _seed_agent_run, _stored_run_events

from app.domains.agent_runs.event_sink import _AgentRunEventSink
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.service import get_agent_run_save_points, handle_agent_control_message
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantDraftResponse, AssistantReviseResponse


def test_chapter_write_brief_pauses_without_touching_disk(
    session,
    tmp_path,
    monkeypatch,
) -> None:
    project = tmp_path / "project"
    (project / "正文").mkdir(parents=True)
    target = project / "正文" / "第001章.md"
    target.write_text("", encoding="utf-8")
    monkeypatch.setattr(
        assistant_service,
        "chat_reply",
        lambda *_args, **_kwargs: {"reply": '{"goal":"建立冲突","required_beats":["见面"]}'},
    )
    run = _seed_agent_run(session, public_id="run-chapter-brief")
    run.permission_profile = "ask"
    session.commit()
    result = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第一章",
            "args": {
                "project_path": str(project),
                "file_path": str(target),
                "context_bundle": {"files": []},
            },
        },
    )
    assert result["agent_result"]["confirmation_kind"] == "chapter_brief"
    assert result["agent_result"]["chapter_brief"]["goal"] == "建立冲突"
    assert result["runtime_interruption"]["status"] == "paused"
    assert target.read_text(encoding="utf-8") == ""
    pending = get_agent_run_save_points(session, run.public_id)["runtime_recovery"]["latest_pending_call"]
    assert pending
    assert str(project) not in str([event.payload for event in _stored_run_events(session, run)])


def test_chapter_write_resume_runs_check_and_emits_one_patch(
    session,
    tmp_path,
    monkeypatch,
) -> None:
    project = tmp_path / "project"
    (project / "正文").mkdir(parents=True)
    target = project / "正文" / "第001章.md"
    target.write_text("", encoding="utf-8")
    calls: list[str] = []

    def fake_chat(_session, *, user_message, context_block, assistant_session_id):
        calls.append(user_message)
        if "整理成 Chapter Brief" in user_message:
            return {"reply": '{"goal":"建立冲突","required_beats":["见面"]}'}
        return {"reply": '{"findings": [{"rule":"advisory","severity":"hard","message":"建议","evidence":"正文"}]}' }

    monkeypatch.setattr(assistant_service, "chat_reply", fake_chat)
    monkeypatch.setattr(
        assistant_service,
        "draft_file_content",
        lambda *_args, **_kwargs: AssistantDraftResponse(
            content="一" * 1800,
            summary="草稿完成",
            model="fake",
            latency_ms=1,
            completion_tokens=10,
            assistant_session_id=1,
        ),
    )
    run = _seed_agent_run(session, public_id="run-chapter-resume")
    run.permission_profile = "ask"
    session.commit()
    initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第一章",
            "args": {"project_path": str(project), "file_path": str(target), "context_bundle": {"files": []}},
        },
    )
    brief = initial["agent_result"]["chapter_brief"]
    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"chapter_brief": brief},
    )
    assert control.resumed_result is not None
    resumed = control.resumed_result
    assert resumed["intent"] == "chapter.write"
    assert resumed["proposed_patch"]["before"] == ""
    assert resumed["proposed_patch"]["after"] == "一" * 1800
    assert resumed["agent_result"]["chapter_check"]["status"] == "pass"
    assert target.read_text(encoding="utf-8") == ""
    assert len(calls) == 2


def test_chapter_write_repairs_once_then_blocks_without_patch(
    session,
    tmp_path,
    monkeypatch,
) -> None:
    project = tmp_path / "project"
    (project / "正文").mkdir(parents=True)
    target = project / "正文" / "第001章.md"
    target.write_text("", encoding="utf-8")
    check_calls = 0
    repair_calls = 0

    def fake_chat(_session, *, user_message, context_block, assistant_session_id):
        nonlocal check_calls
        if "整理成 Chapter Brief" in user_message:
            return {"reply": '{"goal":"建立冲突","required_beats":["见面"]}'}
        check_calls += 1
        return {
            "reply": '{"findings":[{"rule":"missing_required_beat","severity":"hard",'
            '"message":"缺少见面","line":1,"evidence":"开场独白"}]}'
        }

    def fake_revise(*_args, **_kwargs):
        nonlocal repair_calls
        repair_calls += 1
        return AssistantReviseResponse(
            before="一" * 1800,
            after="二" * 1800,
            summary="修复完成",
            model="fake",
            latency_ms=1,
            completion_tokens=10,
            assistant_session_id=1,
        )

    monkeypatch.setattr(assistant_service, "chat_reply", fake_chat)
    monkeypatch.setattr(
        assistant_service,
        "draft_file_content",
        lambda *_args, **_kwargs: AssistantDraftResponse(
            content="一" * 1800,
            summary="草稿完成",
            model="fake",
            latency_ms=1,
            completion_tokens=10,
            assistant_session_id=1,
        ),
    )
    monkeypatch.setattr(assistant_service, "revise_file_content", fake_revise)
    run = _seed_agent_run(session, public_id="run-chapter-blocked")
    run.permission_profile = "ask"
    session.commit()
    initial = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "intent": "chapter.write",
            "user_message": "写第一章",
            "args": {"project_path": str(project), "file_path": str(target), "context_bundle": {"files": []}},
        },
    )
    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"chapter_brief": initial["agent_result"]["chapter_brief"]},
    )
    assert control.resumed_result is not None
    assert control.resumed_result.get("proposed_patch") is None
    assert control.resumed_result["agent_result"]["repair_count"] == 1
    assert control.resumed_result["agent_result"]["chapter_check"]["status"] == "repairable"
    assert check_calls == 2
    assert repair_calls == 1
    assert target.read_text(encoding="utf-8") == ""
