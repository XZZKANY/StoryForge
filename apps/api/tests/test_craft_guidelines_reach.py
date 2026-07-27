"""创作准则触达护栏：四条产字路径的 system prompt 必须都带同一份"什么是好文笔"。

背景（2026-07-28 诊断）：此前 `CRAFT_GUIDELINES` 只进 prose.continue 一条路径，
file.revise / file.create / chat 循环三条全无——作者最常按的修订工具被告知"只改点名处、
逐字保留其余"，却从未被告知什么是好句子，而 project_prose_check 又拿陈词表去查它的产物，
形成检查器与生成器互相不认的局面。本文件把"四条都带"钉成可证伪断言。
"""

from __future__ import annotations

import pytest

from app.common.craft import CLICHE_PHRASES, CRAFT_GUIDELINES, craft_prompt_clause
from app.domains.agent_runs.loop.prompt_context import SYSTEM_PROMPT as CHAT_LOOP_SYSTEM_PROMPT
from app.domains.assistant.continuation import CONTINUE_SYSTEM_PROMPT
from app.domains.assistant.service import _DRAFT_SYSTEM_PROMPT, _REVISE_SYSTEM_PROMPT

_PROSE_PRODUCING_PROMPTS = {
    "chat 循环（agent_runs.loop.prompt_context）": CHAT_LOOP_SYSTEM_PROMPT,
    "file.revise（assistant.service）": _REVISE_SYSTEM_PROMPT,
    "file.create（assistant.service）": _DRAFT_SYSTEM_PROMPT,
    "prose.continue（assistant.continuation）": CONTINUE_SYSTEM_PROMPT,
}


@pytest.mark.parametrize("label", sorted(_PROSE_PRODUCING_PROMPTS))
def test_every_prose_path_carries_craft_guidelines(label: str) -> None:
    """四条产字路径逐条带全部创作准则（少一条即红）。"""

    prompt = _PROSE_PRODUCING_PROMPTS[label]
    missing = [
        guideline for guideline in CRAFT_GUIDELINES if guideline.rstrip("。") not in prompt
    ]
    assert not missing, f"{label} 缺创作准则：{missing}"


@pytest.mark.parametrize("label", sorted(_PROSE_PRODUCING_PROMPTS))
def test_every_prose_path_carries_cliche_list(label: str) -> None:
    """陈词表逐词进 prompt：生成器与 project_prose_check 的检查口径必须同源。"""

    prompt = _PROSE_PRODUCING_PROMPTS[label]
    missing = [phrase for phrase in CLICHE_PHRASES if phrase not in prompt]
    assert not missing, f"{label} 缺陈词条目：{missing}"


def test_craft_clause_is_single_sourced_not_copied() -> None:
    """准则只有 app.common.craft 一份：四条 prompt 都必须含同一子句原文。

    有人手抄一份改词就红——这正是下沉 common 前 book_runs / continuation 各存一份的风险。
    """

    clause = craft_prompt_clause()
    for label, prompt in _PROSE_PRODUCING_PROMPTS.items():
        assert clause in prompt, f"{label} 未使用 craft_prompt_clause() 单一来源"


def test_revise_prompt_bounds_craft_to_touched_sentences() -> None:
    """修订路径必须同时保留"不扩大改动范围"的约束。

    创作准则若被模型读成"把全篇不合准则的句子都改掉"，file.revise 就从最小改动
    变成整篇重写，直接毁掉补丁可审性。
    """

    assert "不要无谓改写或扩大改动范围" in _REVISE_SYSTEM_PROMPT
    assert "不构成扩大改动范围的理由" in _REVISE_SYSTEM_PROMPT


def test_book_runs_prompts_reuse_shared_craft_source() -> None:
    """整书管线的 CRAFT_GUIDELINES 与 common 同一对象，不是平行副本。"""

    from app.domains.book_runs.prompts import CRAFT_GUIDELINES as book_runs_guidelines

    assert book_runs_guidelines is CRAFT_GUIDELINES
