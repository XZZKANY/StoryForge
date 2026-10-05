"""Project/session and current-report identity at actual application boundaries."""

from __future__ import annotations

import json
from copy import deepcopy

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import agent_result
from sqlalchemy import select

from app.common.exceptions import ConflictError
from app.domains.agent_runs.models import AgentArtifact
from app.domains.agent_runs.revise_delivery import verify_review_source
from app.domains.assistant import service
from app.domains.assistant.models import AssistantMessage, AssistantToolCall
from app.domains.assistant.schemas import (
    AssistantContinueRequest,
    AssistantDraftRequest,
    AssistantReviseRequest,
    AssistantSessionCreate,
)
from app.domains.ide import review_reasoning


@pytest.mark.parametrize("entry", ["revise", "draft", "continue", "stream"])
def test_writing_facades_reject_unbound_history_before_generation_or_new_evidence(
    session, tmp_path, monkeypatch, entry
):
    _enable_loop_env(monkeypatch)
    legacy = service.create_assistant_session(
        session,
        AssistantSessionCreate(
            title="旧会话", task_type="chat", messages=[{"role": "user", "content": "OTHER_PROJECT_HISTORY"}]
        ),
    )
    calls = []
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *_, **__: calls.append(True) or {"content": "新正文。"})
    values = {"file_path": "正文.md", "project_root": str(tmp_path), "assistant_session_id": legacy.id}
    with pytest.raises(ConflictError, match="会话.*归属|未绑定"):
        if entry == "revise":
            service.revise_file_content(session, AssistantReviseRequest(**values, content="正文。", instruction="修订"))
        elif entry == "draft":
            service.draft_file_content(session, AssistantDraftRequest(**values, instruction="起草"))
        elif entry == "continue":
            service.draft_continuation(session, AssistantContinueRequest(**values, content="正文。", cursor_line=1))
        else:
            service.stream_continue_prose(session, AssistantContinueRequest(**values, content="正文。", cursor_line=1))
    assert calls == []
    assert [row.content for row in session.scalars(select(AssistantMessage))] == ["OTHER_PROJECT_HISTORY"]
    assert list(session.scalars(select(AssistantToolCall))) == []


def test_live_loop_rejects_unbound_history_without_even_an_outer_model_call(client, session, tmp_path, monkeypatch):
    _enable_loop_env(monkeypatch)
    legacy = service.create_assistant_session(
        session,
        AssistantSessionCreate(
            title="旧会话", task_type="chat", messages=[{"role": "user", "content": "OTHER_PROJECT_HISTORY"}]
        ),
    )
    calls = _fake_llm_script(monkeypatch, [{"content": "not allowed", "tool_calls": []}])
    result = agent_result(
        client,
        "scope-legacy",
        run_id="run-scope-legacy",
        assistant_session_id=legacy.id,
        user_message="看当前项目",
        args={"project_path": str(tmp_path)},
    )
    assert result["type"] == "error", result
    assert calls == []
    assert [row.content for row in session.scalars(select(AssistantMessage))] == ["OTHER_PROJECT_HISTORY"]


def test_relative_report_and_relative_target_use_same_project_base(tmp_path):
    import hashlib

    content = "正文。"
    verify_review_source(
        {"file_path": "正文.md", "content_sha256": hashlib.sha256(content.encode()).hexdigest()},
        "正文.md",
        content,
        str(tmp_path),
    )


def _call(name, arguments):
    return {
        "content": "",
        "tool_calls": [
            {"id": name, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}
        ],
    }


@pytest.mark.parametrize(
    "state", ["current", "changed", "other-session", "foreign-offered", "superseded", "tampered", "unknown", "zero"]
)
@pytest.mark.parametrize("entry", ["live", "fixed"])
def test_cross_run_second_issue_is_bound_to_current_session_report(
    client, session, tmp_path, monkeypatch, state, entry
):
    _enable_loop_env(monkeypatch)
    target = tmp_path / "正文.md"
    original = "林岚停在门口。\n她拿着铜钥匙。"
    target.write_text(original, encoding="utf-8")
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(review_reasoning, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(
        review_reasoning,
        "_call_llm",
        lambda *_, **__: {
            "content": json.dumps(
                [
                    {
                        "severity": "high",
                        "code": "motivation",
                        "message": "UNSELECTED_FIRST_SENTINEL",
                        "evidence": "林岚",
                    },
                    {
                        "severity": "high",
                        "code": "motivation",
                        "message": "SELECTED_SECOND_SENTINEL",
                        "evidence": "铜钥匙",
                    },
                ]
            )
        },
    )

    def review(run_id, session_id=None):
        _fake_llm_script(
            monkeypatch, [_call("file_review", {"path": "正文.md"}), {"content": "审稿已返回", "tool_calls": []}]
        )
        return agent_result(
            client,
            run_id,
            run_id=run_id,
            assistant_session_id=session_id,
            user_message="审稿",
            args={"project_path": str(tmp_path)},
        )

    reviewed = review("run-ordinal-review")
    assert reviewed["type"] == "agent_result", reviewed
    assistant_id = reviewed["assistant_session_id"]
    report = (
        session.scalars(select(AgentArtifact).where(AgentArtifact.kind == "review_report").order_by(AgentArtifact.id))
        .first()
        .payload
    )
    assert len(report["issues"]) >= 2
    offered = None
    if state == "changed":
        target.write_text(original + "\n作者的新内容。", encoding="utf-8")
    elif state in {"other-session", "foreign-offered"}:
        assistant_id = service.create_assistant_session(
            session, AssistantSessionCreate(title="其他会话", task_type="chat", project_path=str(tmp_path))
        ).id
        if state == "foreign-offered":
            offered = report
    elif state == "tampered":
        offered = deepcopy(report)
        offered["issues"][1]["message"] = "TAMPERED_SENTINEL"
    elif state == "superseded":
        review("run-ordinal-newer", assistant_id)
        offered = report
    prompts = []

    def writer(_source, **kwargs):
        prompts.append(kwargs["user_prompt"])
        return {"content": original}

    monkeypatch.setattr(service, "_call_llm_streamed", writer)
    _fake_llm_script(
        monkeypatch,
        [
            _call(
                "file_revise",
                {
                    "path": "正文.md",
                    "instruction": "只改第一条",
                    "selected_issue_ids": [report["issues"][0]["id"]],
                    "included_categories": ["character"],
                    "excluded_categories": ["plot"],
                },
            ),
            {"content": "工具结果已说明", "tool_calls": []},
        ],
    )
    result = agent_result(
        client,
        f"ordinal-{state}",
        run_id=f"run-ordinal-{state}",
        intent="file.revise" if entry == "fixed" else None,
        assistant_session_id=assistant_id,
        user_message="只修第99条问题"
        if state == "unknown"
        else "只修第0条问题"
        if state == "zero"
        else "只修第2条问题",
        args={
            "project_path": str(tmp_path),
            **(
                {
                    "file_path": str(target),
                    "content": target.read_text(encoding="utf-8"),
                    "instruction": "只改第一条",
                    "selected_issue_ids": [report["issues"][0]["id"]],
                    "excluded_categories": ["plot"],
                }
                if entry == "fixed"
                else {}
            ),
            **({"review_report": offered} if offered else {}),
        },
    )
    if state in {"current", "tampered"}:
        assert len(prompts) == 1
        assert "SELECTED_SECOND_SENTINEL" in prompts[0] and "UNSELECTED_FIRST_SENTINEL" not in prompts[0]
        assert "TAMPERED_SENTINEL" not in prompts[0]
        trace = next(t for t in result["tool_trace"] if t["tool_name"] == "file.revise")
        assert trace["input_summary"]["applied_scope"]["issue_ids"] == [report["issues"][1]["id"]]
    else:
        assert prompts == []
        assert result.get("proposed_patch") is None
    assert target.read_text(encoding="utf-8") == (original + "\n作者的新内容。" if state == "changed" else original)


@pytest.mark.parametrize("entry", ["revise", "draft", "continue", "stream"])
def test_new_writing_sessions_keep_project_ownership(session, tmp_path, monkeypatch, entry):
    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *_, **__: {"content": "正文。"})
    values = {"file_path": "正文.md", "project_root": str(tmp_path)}
    if entry == "revise":
        service.revise_file_content(session, AssistantReviseRequest(**values, content="正文。", instruction="修订"))
    elif entry == "draft":
        service.draft_file_content(session, AssistantDraftRequest(**values, instruction="起草"))
    elif entry == "continue":
        service.draft_continuation(session, AssistantContinueRequest(**values, content="正文。", cursor_line=1))
    else:
        service.stream_continue_prose(session, AssistantContinueRequest(**values, content="正文。", cursor_line=1))
    recent = service.list_recent_assistant_sessions(session)
    assert len(recent) == 1 and recent[0].project_path == str(tmp_path)


def test_project_scope_alias_is_same_but_missing_root_is_not(session, tmp_path):
    owned = service.create_assistant_session(
        session, AssistantSessionCreate(title="当前", task_type="chat", project_path=str(tmp_path))
    )
    service.assert_session_project_matches(owned, str(tmp_path / "child" / ".."))
    with pytest.raises(ConflictError):
        service.assert_session_project_matches(owned, None)
    projectless = service.create_assistant_session(session, AssistantSessionCreate(title="项目无关", task_type="chat"))
    service.assert_session_project_matches(projectless, None)


@pytest.mark.parametrize("reported,target", [("../outside.md", "../outside.md"), ("正文.md", "另文.md")])
def test_review_file_identity_cannot_escape_or_switch_project_target(tmp_path, reported, target):
    import hashlib

    from app.domains.agent_runs.errors import AgentOrchestrationError

    with pytest.raises(AgentOrchestrationError):
        verify_review_source(
            {"file_path": reported, "content_sha256": hashlib.sha256("正文。".encode()).hexdigest()},
            target,
            "正文。",
            str(tmp_path),
        )


def test_public_review_resume_keeps_project_and_original_conversation(session, session_factory, tmp_path, monkeypatch):
    from app.domains.agent_runs import service as runs
    from app.domains.assistant.models import AssistantSession

    _enable_loop_env(monkeypatch)
    target = tmp_path / "正文.md"
    target.write_text("正文。", encoding="utf-8")
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(review_reasoning, "resolved_llm_env", lambda: {})
    calls = []
    monkeypatch.setattr(review_reasoning, "_call_llm", lambda *_, **__: calls.append(True) or {"content": "[]"})
    original = runs.record_agent_event
    paused = []

    def record(db, run, **kwargs):
        event = original(db, run, **kwargs)
        if (
            kwargs.get("event_type") == "tool_trace"
            and kwargs.get("payload", {}).get("trace", {}).get("tool_name") == "context.load"
            and not paused
        ):
            paused.append(True)
            with session_factory() as other:
                runs.record_agent_control_event(
                    other, public_id=run.public_id, session_id=run.session_id, control_type="pause_run"
                )
        return event

    monkeypatch.setattr(runs, "record_agent_event", record)
    message = {
        "intent": "file.review",
        "user_message": "审稿",
        "args": {"project_path": str(tmp_path), "file_path": str(target), "content": "正文。"},
    }
    started = runs.start_agent_user_message_run(session, agent_session_id="review-resume", message=message)
    initial = runs.execute_agent_user_message_run(
        session, run=started.run, agent_session_id="review-resume", message=message
    )
    assert initial["runtime_interruption"]["status"] == "paused" and calls == []
    aid = initial["assistant_session_id"]
    pending = session.scalars(select(AgentArtifact).where(AgentArtifact.kind == "runtime_pending_call")).one()
    assert pending.payload["resume_message"]["assistant_session_id"] == aid
    assert pending.payload["resume_message"]["args"]["project_path"] == str(tmp_path)
    resumed = runs.handle_agent_control_message(
        session, public_id=started.run.public_id, session_id="review-resume", control_type="resume_run", payload={}
    ).resumed_result
    assert resumed is not None and resumed["assistant_session_id"] == aid
    assert len(calls) == 3
    owned = list(session.scalars(select(AssistantSession)))
    assert len(owned) == 1 and owned[0].id == aid and owned[0].project_path == str(tmp_path)
    assert target.read_text(encoding="utf-8") == "正文。"
