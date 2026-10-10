from __future__ import annotations

import pytest
from agent_transport import agent_result
from fastapi.testclient import TestClient

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


def test_bookrun_start_intent_no_longer_routes() -> None:
    """bookrun.start 显式 intent 已摘除（2026-08-01 作者拍板退役批量整书）。

    原先两条端到端用例（preflight 需确认 / 确认后复用命令表）随入口一并下线。
    2026-10-09 整条 BookRun 链（含 REST 层与其测试）已物理删除，此处已无可回滚的实现，
    本用例退化为「这个 intent 不得再出现」的防回归闸。
    """

    from app.domains.agent_runs.intent import SUPPORTED_INTENTS

    assert "bookrun.start" not in SUPPORTED_INTENTS


def test_book_id_blueprint_id_args_no_longer_hijack_into_bookrun() -> None:
    """带 book_id + blueprint_id 的结构化参数不再抢跑 bookrun.start，落回 chat.explain 循环。"""

    from app.domains.agent_runs.intent import _detect_intent

    intent = _detect_intent("随便写点什么", {"book_id": 1, "blueprint_id": 2}, None)
    assert intent != "bookrun.start"


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


def test_revise_drift_ratio_counts_real_changes_not_bounding_span() -> None:
    """T05：首尾各改一行、中间三行原样，真实改动是 2/5 而非包围跨度 5/5。"""

    before = "\n".join(["第一行开头。", "第二行不动。", "第三行不动。", "第四行不动。", "第五行收尾。"])
    after = "\n".join(["第一行改了。", "第二行不动。", "第三行不动。", "第四行不动。", "第五行也改了。"])
    changed, total, ratio = _revise_drift_ratio(before, after)
    assert (changed, total) == (2, 5)
    assert ratio == pytest.approx(0.4)
    # 2/5 未越 0.5 阈值：旧实现按改动包围跨度算成 5/5=1.0，会误报整篇重写。
    assert _scope_warning({"narrow": True}, before, after) is None


def test_revise_drift_ratio_ignores_blank_lines_when_measuring_rewrite() -> None:
    """T05-F1：中文稿空行约占一半，逐段重写时真实改动接近全部非空行，不能被空行稀释到阈值下。"""

    before = "\n".join(["第一段原样。", "", "第二段原样。", "", "第三段原样。", "", "第四段原样。", ""])
    after = "\n".join(["第一段改过。", "", "第二段改过。", "", "第三段改过。", "", "第四段改过。", ""])
    changed, total, ratio = _revise_drift_ratio(before, after)
    # 分母只数 4 行非空原文；旧实现把 4 个空行也算进去，4/8=0.5 恰好压线不报警。
    assert (changed, total) == (4, 4)
    assert ratio == 1.0
    assert _scope_warning({"narrow": True}, before, after) is not None


def test_revise_drift_ratio_blank_file_write_is_not_flagged() -> None:
    """T05-F2：空稿写入正文时无非空原文行，不该误报「改动了约 100% 原文行」。"""

    changed, total, ratio = _revise_drift_ratio("", "林岚推开门，海风灌进来。")
    assert (changed, total, ratio) == (0, 0, 0.0)
    assert _scope_warning({"narrow": True}, "", "林岚推开门，海风灌进来。") is None


def test_revise_drift_ratio_blank_lines_dont_dilute_small_targeted_edit() -> None:
    """T05-F3：空行密集的稿件里只改一句，分母仍是非空原文行，比例保持低位。"""

    before = "\n".join(["甲段。", "", "乙段。", "", "丙段。", "", "丁段。"])
    after = "\n".join(["甲段。", "", "乙段改了。", "", "丙段。", "", "丁段。"])
    changed, total, ratio = _revise_drift_ratio(before, after)
    assert (changed, total, ratio) == (1, 4, 0.25)
    assert _scope_warning({"narrow": True}, before, after) is None


def test_revise_drift_ratio_counts_inserted_lines() -> None:
    """T05-F4：纯插入大段新段落（原文非空行逐字未动、只新增）旧口径 changed=0、ratio=0，
    越界提醒完全不可见；新增的非空行必须计入改动量分子。"""

    before = "\n".join(["第一段原样。", "第二段原样。", "第三段原样。", "第四段原样。"])
    after = "\n".join(
        [
            "第一段原样。",
            "第二段原样。",
            "第三段原样。",
            "第四段原样。",
            "新增段一，展开了一段新的心理描写。",
            "新增段二。",
            "新增段三。",
        ]
    )
    changed, total, ratio = _revise_drift_ratio(before, after)
    assert (changed, total) == (3, 4)
    assert ratio == pytest.approx(0.75)
    assert _scope_warning({"narrow": True}, before, after) is not None


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
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    before = "\n".join(["第一段。", "第二段。", "第三段。", "第四段。"])
    after = "\n".join(["改写一。", "改写二。", "改写三。", "改写四。"])

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        return {"content": after, "completion_tokens": 8, "latency_ms": 10}

    for _seam in ("_call_llm", "_call_llm_streamed"):
        monkeypatch.setattr(assistant_service, _seam, fake_call_llm)

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
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    before = "\n".join(["第一段。", "第二段。", "第三段。", "第四段。"])
    after = "\n".join(["改写一。", "改写二。", "改写三。", "改写四。"])

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        return {"content": after, "completion_tokens": 8, "latency_ms": 10}

    for _seam in ("_call_llm", "_call_llm_streamed"):
        monkeypatch.setattr(assistant_service, _seam, fake_call_llm)

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



def test_scope_warning_caps_display_for_pure_insertion() -> None:
    """T05：短文件纯插入时 changed 会大于原文行数，展示层须按原文行数封顶，
    不再输出「改动了约 400% 的原文行（8/2 行）」这类自相矛盾文案；判据（是否告警）不变。"""

    before = "\n".join(["甲句。", "乙句。"])
    after = "\n".join(["甲句。", "乙句。", *(f"新增第{index}段。" for index in range(1, 9))])
    changed, total, ratio = _revise_drift_ratio(before, after)
    assert (changed, total) == (8, 2)
    assert ratio == 4.0
    warning = _scope_warning({"narrow": True}, before, after)
    assert warning is not None
    assert warning["drift_ratio"] == 4.0
    assert warning["changed_lines"] == 8
    assert warning["total_lines"] == 2
    assert "改动了约 100% 的原文行（2/2 行）+ 新增 8 行" in warning["message"]
    assert "400%" not in warning["message"]
