from __future__ import annotations

import pytest
from agent_transport import agent_result
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint
from test_ide_agent_orchestrator import _seed_chapter_review_context

from app.domains.agent_runs.revise_scope import (
    _is_broad_revise,
    _resolve_revise_scope,
    _revise_drift_ratio,
    _scope_warning,
    _scoped_revise_instruction,
)
from app.domains.assistant import service as assistant_service


def test_confirm_writeback_phrases_not_classified_as_revise(client: TestClient) -> None:
    for phrase in ("确认写回", "应用当前补丁", "接受当前修订"):
        message = agent_result(
            client,
            f"session-confirm-writeback-{phrase}",
            user_message=phrase,
            args={
                "file_path": "正文/第01章.md",
                "content": "当前正文",
                "context": "当前正文",
            },
        )

        assert message["intent"] == "chat.explain"
        assert message["proposed_patch"] is None


def test_agent_message_with_file_context_can_remain_chat_explain(client: TestClient) -> None:
    message = agent_result(
        client,
        "session-file-context-explain",
        user_message="这一段主要在表达什么",
        args={
            "file_path": "正文/第03章.md",
            "content": "林岚走进港口。她看见灯塔熄灭，却没有停下。",
            "context": "林岚走进港口。她看见灯塔熄灭，却没有停下。",
            "selection": "林岚走进港口。她看见灯塔熄灭，却没有停下。",
        },
    )

    assert message["type"] == "agent_result"
    assert message["intent"] == "chat.explain"
    assert message["proposed_patch"] is None
    assert message["agent_result"]["requires_user_confirmation"] is False
    assert message["tool_trace"] == []


def test_agent_user_message_reuses_existing_assistant_session(client: TestClient) -> None:
    first = agent_result(
        client,
        "session-multi-turn",
        user_message="先解释这一段",
        intent="chat.explain",
        args={"context": "第一轮上下文"},
    )
    second = agent_result(
        client,
        "session-multi-turn",
        assistant_session_id=first["assistant_session_id"],
        user_message="继续，换个角度",
        intent="chat.explain",
        args={"context": "第二轮上下文"},
    )

    assert second["type"] == "agent_result"
    assert second["assistant_session_id"] == first["assistant_session_id"]

    session_id = first["assistant_session_id"]
    session_detail = client.get(f"/api/assistant/sessions/{session_id}").json()
    assert [message["role"] for message in session_detail["messages"]] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert session_detail["messages"][0]["content"] == "先解释这一段"
    assert session_detail["messages"][2]["content"] == "继续，换个角度"


def test_agent_user_message_returns_error_for_missing_assistant_session(client: TestClient) -> None:
    message = agent_result(
        client,
        "session-missing-assistant",
        assistant_session_id=999999,
        user_message="继续上一轮",
        intent="chat.explain",
        args={"context": "正文"},
    )

    assert message["type"] == "error"
    assert message["session_id"] == "session-missing-assistant"
    assert "Assistant 会话不存在" in message["detail"]


def test_agent_user_message_chapter_review_calls_registry_and_waits_for_confirmation(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    context = _seed_chapter_review_context(session_factory)

    message = agent_result(
        client,
        "session-chapter-review",
        user_message="审阅第二章，给我修复建议",
        args={"scene_packet_id": context["scene_packet_id"]},
    )

    assert message["type"] == "agent_result"
    assert message["intent"] == "chapter.review"
    assert message["agent_result"]["requires_user_confirmation"] is True
    assert message["proposed_patch"]["kind"] == "repair_patch"
    assert message["proposed_patch"]["repair_patch"]["id"] > 0
    assert message["proposed_patch"]["approval_command"]["command_id"] == "judge.approve"

    tool_names = [item["tool_name"] for item in message["tool_trace"]]
    assert tool_names[:2] == ["judge.run", "judge.repair"]

    session_id = message["assistant_session_id"]
    tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    assert [item["tool_name"] for item in tool_calls][0] == "judge.run"
    assert {item["tool_name"] for item in tool_calls[1:]} == {"judge.repair"}


def test_agent_user_message_chapter_review_stops_after_first_repair_patch(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """多个可修复 issue 时只生成第一个补丁：响应只能承载一个待确认补丁，
    批量 judge.repair 会落库无人能确认的孤儿补丁并改掉 issue 状态。"""

    from app.domains.judge.models import JudgeIssue, RepairPatch

    context = _seed_chapter_review_context(session_factory)

    message = agent_result(
        client,
        "session-chapter-review-single-patch",
        user_message="审阅这一章，给我修复建议",
        args={"scene_packet_id": context["scene_packet_id"]},
    )

    assert message["type"] == "agent_result"
    assert message["agent_result"]["issue_count"] >= 2
    assert message["agent_result"]["repair_patch_count"] == 1
    assert message["agent_result"]["remaining_repairable_issue_count"] >= 1
    assert message["proposed_patch"]["kind"] == "repair_patch"

    with session_factory() as session:
        patches = session.query(RepairPatch).all()
        assert len(patches) == 1
        touched_issues = session.query(JudgeIssue).filter(JudgeIssue.status == "requires_rejudge").all()
        assert len(touched_issues) == 1
        assert touched_issues[0].id == patches[0].judge_issue_id


def test_agent_user_message_bookrun_start_preflight_requires_confirmation(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    scope = seed_locked_blueprint(session_factory)

    message = agent_result(
        client,
        "session-bookrun-preflight",
        user_message="启动这本书的生成流程",
        args={
            "book_id": scope["book_id"],
            "blueprint_id": scope["blueprint_id"],
            "token_budget": 900,
            "chapter_budget": 8,
        },
    )

    assert message["type"] == "agent_result"
    assert message["intent"] == "bookrun.start"
    assert message["agent_result"]["requires_user_confirmation"] is True
    assert message["agent_result"]["confirmation_required"] is True
    assert "book_run" not in message["agent_result"]
    assert message["agent_result"]["confirmation_action"]["args"]["confirmed"] is True
    assert message["agent_result"]["bookrun_plan"]["budget_details"]["token_budget"] == 900
    assert message["agent_result"]["bookrun_plan"]["budget_details"]["chapter_budget"] == 8
    assert message["agent_result"]["bookrun_plan"]["risk_summary"]
    assert message["tool_trace"][0]["status"] == "needs_confirmation"


def test_agent_user_message_bookrun_start_confirmed_reuses_command_registry(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.domains.provider_gateway import service as provider_service
    from app.domains.provider_gateway.runtime_config import load_runtime_provider_config

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "deterministic")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "storyforge-deterministic-writer")
    monkeypatch.delenv("STORYFORGE_LLM_API_KEY", raising=False)
    load_runtime_provider_config.cache_clear()
    provider_service.cache_delete_pattern("storyforge:provider-resolution:*")

    scope = seed_locked_blueprint(session_factory)

    message = agent_result(
        client,
        "session-bookrun-start",
        user_message="启动这本书的生成流程",
        args={
            "book_id": scope["book_id"],
            "blueprint_id": scope["blueprint_id"],
            "token_budget": 900,
            "confirmed": True,
        },
    )

    assert message["type"] == "agent_result"
    assert message["intent"] == "bookrun.start"
    assert message["agent_result"]["writing_run"]["scope"] == "full_book"
    assert message["agent_result"]["writing_run"]["mode"] == "managed"
    assert message["agent_result"]["writing_run"]["status"] == "running"
    assert message["agent_result"]["writing_run_id"] == message["agent_result"]["book_run_id"]
    assert message["agent_result"]["book_run"]["status"] == "running"
    assert message["agent_result"]["book_run_id"] == message["agent_result"]["book_run"]["id"]
    assert message["agent_result"]["writing_run"]["book_run_id"] == message["agent_result"]["book_run"]["id"]
    assert message["agent_result"]["events_url"] == f"/api/ide/runs/{message['agent_result']['book_run_id']}/events"
    assert message["agent_result"]["requires_user_confirmation"] is False
    assert message["agent_result"]["bookrun_plan"]["chapters"] == "按锁定蓝图继续生成下一批章节"
    assert message["agent_result"]["bookrun_plan"]["budget"] == "900 tokens"
    assert message["agent_result"]["bookrun_plan"]["budget_details"]["token_budget"] == 900
    assert "managed 模式" in message["agent_result"]["summary"]
    assert message["tool_trace"][0]["tool_name"] == "bookrun.start"
    assert message["tool_trace"][0]["audit_event_id"].startswith("ide-command-event:")


def test_resolve_revise_scope_marks_freeform_targeted_instruction_narrow() -> None:
    # bug#2 的洞：无 review_report、用「其余别动」式自由指令，旧逻辑既不算约束也不缩范围，整文件直送模型。
    scope = _resolve_revise_scope(None, {"instruction": "压缩雾气意象和旧伤细节，其余别动"})
    assert scope["narrow"] is True
    out = _scoped_revise_instruction("压缩雾气意象和旧伤细节，其余别动", None, scope)
    assert "最小改动约束" in out
    assert "逐字" in out
    assert "压缩雾气意象和旧伤细节，其余别动" in out


def test_resolve_revise_scope_marks_whole_file_rewrite_broad() -> None:
    assert _is_broad_revise("把全文通篇润色重写一遍") is True
    scope = _resolve_revise_scope(None, {"instruction": "把全文通篇润色重写一遍"})
    assert scope["narrow"] is False
    out = _scoped_revise_instruction("把全文通篇润色重写一遍", None, scope)
    # 明确要求全文重写时不附最小改动契约，原样下发。
    assert out == "把全文通篇润色重写一遍"
    assert "最小改动约束" not in out


def test_revise_drift_ratio_small_targeted_edit_stays_low() -> None:
    before = "\n".join(["第一段保持不变。", "第二段要压缩。", "第三段保持不变。", "第四段保持不变。"])
    after = "\n".join(["第一段保持不变。", "第二段压缩了。", "第三段保持不变。", "第四段保持不变。"])
    changed, total, ratio = _revise_drift_ratio(before, after)
    assert (changed, total, ratio) == (1, 4, 0.25)


def test_revise_drift_ratio_whole_file_rewrite_is_high() -> None:
    before = "\n".join(["甲", "乙", "丙", "丁"])
    after = "\n".join(["完全不同一", "完全不同二", "完全不同三", "完全不同四"])
    _changed, _total, ratio = _revise_drift_ratio(before, after)
    assert ratio == 1.0


def test_scope_warning_only_fires_for_narrow_large_drift() -> None:
    before = "\n".join(["甲", "乙", "丙", "丁"])
    big = "\n".join(["改一", "改二", "改三", "改四"])
    small = "\n".join(["甲", "改二", "丙", "丁"])
    warning = _scope_warning({"narrow": True}, before, big)
    assert warning is not None
    assert warning["drift_ratio"] == 1.0
    assert warning["changed_lines"] == 4
    assert "逐块核对" in warning["message"]
    # narrow 但小改动不报警；明确全文重写（narrow=False）即便整文件变也不报警。
    assert _scope_warning({"narrow": True}, before, small) is None
    assert _scope_warning({"narrow": False}, before, big) is None


def test_narrow_revise_flags_scope_warning_when_drift_large(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    before = "\n".join(["第一段。", "第二段。", "第三段。", "第四段。"])
    after = "\n".join(["改写一。", "改写二。", "改写三。", "改写四。"])

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        return {"content": after, "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-revise-scope-warning",
        user_message="只压缩雾气意象，其余别动",
        intent="file.revise",
        args={
            "file_path": "正文/第01章.md",
            "content": before,
            "instruction": "只压缩雾气意象，其余别动",
        },
    )

    warning = message["agent_result"]["scope_warning"]
    assert warning["drift_ratio"] == 1.0
    assert "逐块核对" in warning["message"]
    assert "逐块核对" in message["agent_result"]["summary"]
    revise_trace = next(item for item in message["tool_trace"] if item["tool_name"] == "file.revise")
    assert revise_trace["output_summary"]["scope_warning"]["drift_ratio"] == 1.0


def test_broad_revise_does_not_flag_scope_warning(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    before = "\n".join(["第一段。", "第二段。", "第三段。", "第四段。"])
    after = "\n".join(["改写一。", "改写二。", "改写三。", "改写四。"])

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        return {"content": after, "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-revise-broad-no-warning",
        user_message="把全文通篇重写一遍",
        intent="file.revise",
        args={
            "file_path": "正文/第01章.md",
            "content": before,
            "instruction": "把全文通篇重写一遍",
        },
    )

    assert "scope_warning" not in message["agent_result"]
    revise_trace = next(item for item in message["tool_trace"] if item["tool_name"] == "file.revise")
    assert "scope_warning" not in revise_trace["output_summary"]
