"""live 产字 prompt 的变体注册表。

纪律：
- `baseline` 恒等引用真实构建器（生产代码任何改动自动传导到对照锚）。
- 变体一律**从 baseline 的渲染结果做 section 级删除 / 替换**，不复制 prompt 文案
  （避免双源漂移）；删除前断言目标块恰好出现一次，防误删。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.common.author_voice import build_generation_system_prompt
from app.common.craft import craft_prompt_clause
from app.domains.assistant import service


@dataclass(frozen=True)
class BookVariant:
    id: str
    label: str
    description: str
    build: Callable[..., str]


def _assert_single_block(prompt: str, block: str) -> None:
    """删除前确认目标块恰好出现一次，避免空块或多段误删。"""

    count = prompt.count(block)
    if count != 1:
        raise AssertionError(f"目标块出现 {count} 次（期望 1 次）：{block[:60]!r}")


def _assemble_live(base_prompt: str) -> str:
    """经生产的唯一组装点出 system prompt；project_path=None 即「作者无自定义指令」这一档。"""

    return build_generation_system_prompt(base_prompt, None)


def _build_live_draft_baseline() -> str:
    """live 链 file.create 的生产 system prompt 恒等引用（现为无例形态）。"""

    return _assemble_live(service._DRAFT_SYSTEM_PROMPT)


def _build_live_draft_with_examples() -> str:
    """把好坏对照锚点挂回 live 链——同源替换，不手抄文案。

    `craft_prompt_clause(with_examples=True)` 的返回就是「无例子句 + BAD + GOOD」，
    故整段替换等价于「只加锚点、其余逐字不变」。
    """

    prompt = service._DRAFT_SYSTEM_PROMPT
    _assert_single_block(prompt, craft_prompt_clause())
    return _assemble_live(prompt.replace(craft_prompt_clause(), craft_prompt_clause(with_examples=True)))


# live 链（桌面 file.create）。
LIVE_DRAFT_VARIANTS: dict[str, BookVariant] = {
    "live-baseline": BookVariant("live-baseline", "现生产（无例）", "_DRAFT_SYSTEM_PROMPT 恒等引用", _build_live_draft_baseline),
    "live-with-examples": BookVariant("live-with-examples", "挂回正反例锚点", "同源替换加回 BAD/GOOD 锚点，验删例结论在 live 链是否成立", _build_live_draft_with_examples),
}

BOOK_VARIANTS: dict[str, dict[str, BookVariant]] = {
    "live-draft": LIVE_DRAFT_VARIANTS,
}
