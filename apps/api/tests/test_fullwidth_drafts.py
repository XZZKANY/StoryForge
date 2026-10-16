"""起草统一成全角：模型写成半角的中文标点在出稿前转成全角；数字、英文、网址与 Markdown 语法不动。"""

from __future__ import annotations

import pytest
from agent_loop_runtime_test_support import _enable_loop_env
from sqlalchemy import select

from app.common.punctuation import fullwidth_cjk_punctuation
from app.domains.assistant import service
from app.domains.assistant.models import AssistantToolCall
from app.domains.assistant.schemas import AssistantDraftRequest

HALF = '林晚星醒来的时候,窗外还是暗的.\n\n守卫喝道:"站住!"\n他等了很久...'
FULL = "林晚星醒来的时候，窗外还是暗的。\n\n守卫喝道：“站住！”\n他等了很久……"


def test_half_width_marks_in_chinese_prose_become_full_width():
    assert fullwidth_cjk_punctuation(HALF) == (FULL, 7)
    assert fullwidth_cjk_punctuation(FULL) == (FULL, 0)
    # 半角排版留下的空格随标点一起收掉。
    assert fullwidth_cjk_punctuation('他说, 走吧. 我说: "好"') == ("他说，走吧。我说：“好”", 5)
    # 两侧都是英文字母的单引号是撇号，不算引号。
    assert fullwidth_cjk_punctuation("she don't 说'好'") == ("she don't 说‘好’", 2)


@pytest.mark.parametrize(
    "text",
    [
        "3,000 元在 10:30 到账，第 2.5 章。",
        "见[第一章](第一章.md)，再看![图](a.png)",
        "他用了 iPhone. She don't know.",
        "http://example.cn/林舟",
        '"OK" is fine.',
        '"奇数"个"引号',  # 配不上对就整行不动，留给作者看
        "(OK)而已",
        "---",
    ],
)
def test_non_chinese_context_is_left_alone(text):
    assert fullwidth_cjk_punctuation(text) == (text, 0)


def test_draft_comes_back_full_width_and_the_count_is_recorded(session, tmp_path, monkeypatch):
    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *_, **__: {"content": HALF})
    response = service.draft_file_content(
        session,
        AssistantDraftRequest(
            file_path=str(tmp_path / "正文/第001章.md"), project_root=str(tmp_path), instruction="起草"
        ),
    )
    assert response.content == FULL
    assert response.summary == f"已起草 {tmp_path / '正文/第001章.md'} 初稿，约 {len(FULL)} 字。"
    call = session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.draft")).one()
    assert call.output_summary["content_chars"] == len(FULL)
    assert call.output_summary["punctuation_normalized"] == 7


def test_already_full_width_draft_records_nothing(session, tmp_path, monkeypatch):
    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *_, **__: {"content": FULL})
    response = service.draft_file_content(
        session,
        AssistantDraftRequest(file_path=str(tmp_path / "第001章.md"), project_root=str(tmp_path), instruction="起草"),
    )
    assert response.content == FULL
    call = session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.draft")).one()
    assert "punctuation_normalized" not in call.output_summary
