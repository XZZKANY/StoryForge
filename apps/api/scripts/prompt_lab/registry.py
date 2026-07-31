"""产字 / 评稿 / 修订 prompt 的变体注册表。

纪律：
- `baseline` 恒等引用真实构建器（生产代码任何改动自动传导到对照锚）。
- 变体一律**从 baseline 的渲染结果做 section 级删除 / 替换**，不复制 prompt 文案
  （避免双源漂移）；删除前断言目标块恰好出现一次，防误删。
- 唯一例外是 task-rewrite（变体的本质就是「换文案」），旧行从 baseline 里替换。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.common.author_voice import build_generation_system_prompt
from app.common.craft import craft_prompt_clause
from app.domains.assistant import service
from app.domains.book_runs.prompts import builder
from app.domains.book_runs.prompts._sections import craft_section, style_section
from app.domains.book_runs.prompts.models import NarrativeContext

# baseline 的任务行（builder.build_draft_prompt 的「任务」段首行），task-rewrite 用
# 它做精确替换；测试锚定该串恰好出现一次。
_TASK_LINE = "基于以下约束写一段可直接批准的小说正文，避免说明腔与大纲腔，用画面、动作和对话呈现。"
_TASK_LINE_NEW = (
    "基于以下约束写一段可直接批准的小说正文。"
    "每一句都要要么推进情节、要么加深人物、要么制造氛围——三者至少占一样，否则删掉。"
)


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


def _build_draft_baseline(
    ctx: NarrativeContext, *, preview_chars: int = 120, full_chapter: bool = False
) -> str:
    return builder.build_draft_prompt(ctx, preview_chars=preview_chars, full_chapter=full_chapter)


def _build_draft_no_craft(
    ctx: NarrativeContext, *, preview_chars: int = 120, full_chapter: bool = False
) -> str:
    prompt = _build_draft_baseline(ctx, preview_chars=preview_chars, full_chapter=full_chapter)
    block = craft_section()
    _assert_single_block(prompt, block)
    return prompt.replace(block, "")


def _build_draft_no_style(
    ctx: NarrativeContext, *, preview_chars: int = 120, full_chapter: bool = False
) -> str:
    prompt = _build_draft_baseline(ctx, preview_chars=preview_chars, full_chapter=full_chapter)
    block = style_section(ctx.style)
    _assert_single_block(prompt, block)
    return prompt.replace(block, "")


def _build_draft_task_rewrite(
    ctx: NarrativeContext, *, preview_chars: int = 120, full_chapter: bool = False
) -> str:
    prompt = _build_draft_baseline(ctx, preview_chars=preview_chars, full_chapter=full_chapter)
    _assert_single_block(prompt, _TASK_LINE)
    return prompt.replace(_TASK_LINE, _TASK_LINE_NEW)


def _assemble_live(base_prompt: str) -> str:
    """经生产的唯一组装点出 system prompt；project_path=None 即「作者无自定义指令」这一档。"""

    return build_generation_system_prompt(base_prompt, None)


def _build_live_draft_baseline() -> str:
    """live 链 file.create 的生产 system prompt 恒等引用（现为无例形态）。"""

    return _assemble_live(service._DRAFT_SYSTEM_PROMPT)


def _build_live_draft_with_examples() -> str:
    """把好坏对照锚点挂回 live 链——同源替换，不手抄文案。

    `craft_prompt_clause(with_examples=True)` 的返回就是「无例子句 + BAD + GOOD」，
    故整段替换等价于「只加锚点、其余逐字不变」，与 book_runs 侧删例互为镜像操作。
    """

    prompt = service._DRAFT_SYSTEM_PROMPT
    _assert_single_block(prompt, craft_prompt_clause())
    return _assemble_live(prompt.replace(craft_prompt_clause(), craft_prompt_clause(with_examples=True)))


def _build_critique_baseline(ctx: NarrativeContext, draft: str) -> str:
    return builder.build_critique_prompt(ctx, draft)


def _build_critique_no_pass(ctx: NarrativeContext, draft: str) -> str:
    # 堵住「可单行通过」逃生门：在输出要求段末尾追加禁令（验证它是否让评稿偷懒）
    prompt = _build_critique_baseline(ctx, draft)
    return prompt + "\n禁止输出单行“通过”。必须给出 DECISION 与至少一条 ISSUE。"


def _build_revision_baseline(ctx: NarrativeContext, draft: str, issues: tuple[str, ...]) -> str:
    return builder.build_revision_prompt(ctx, draft, issues)


# --- 注册表：kind → {variant_id: BookVariant} ---

DRAFT_VARIANTS: dict[str, BookVariant] = {
    "baseline": BookVariant("baseline", "原样", "build_draft_prompt 恒等引用", _build_draft_baseline),
    "no-craft": BookVariant("no-craft", "去创作准则段", "量化创作准则（show don't tell 等）对成稿的贡献", _build_draft_no_craft),
    "no-style": BookVariant("no-style", "去文风要求段", "量化风格包注入（禁用词/示例句/克制）对成稿的贡献", _build_draft_no_style),
    "task-rewrite": BookVariant("task-rewrite", "任务行措辞改写", "「每句三检（推进/加深/氛围）」式任务行 vs 现任务行", _build_draft_task_rewrite),
    # wave2 已合入删例（no-examples → adopt）：生产 craft section 现为无例形态，
    # no-examples / half-examples 变体退役（patch 钩子已删，渲染与 baseline 相同）。
}

CRITIQUE_VARIANTS: dict[str, BookVariant] = {
    "baseline": BookVariant("baseline", "原样", "build_critique_prompt 恒等引用", _build_critique_baseline),
    "no-pass": BookVariant("no-pass", "禁单行通过", "堵住「可单行通过」逃生门，验证评稿是否偷懒", _build_critique_no_pass),
}

REVISION_VARIANTS: dict[str, BookVariant] = {
    "baseline": BookVariant("baseline", "原样", "build_revision_prompt 恒等引用", _build_revision_baseline),
}

# live 链（桌面 file.create）。与 DRAFT_VARIANTS 是两条独立 prompt 链：本组量的是扁平
# 子句形态，DRAFT_VARIANTS 量的是 book_runs 的多行 section 形态。wave1-3 只跑过后者，
# 「删例更好」迁到 live 链此前是外推（见 2026-08-01 verification-report），本组补实测。
LIVE_DRAFT_VARIANTS: dict[str, BookVariant] = {
    "live-baseline": BookVariant("live-baseline", "现生产（无例）", "_DRAFT_SYSTEM_PROMPT 恒等引用", _build_live_draft_baseline),
    "live-with-examples": BookVariant("live-with-examples", "挂回正反例锚点", "同源替换加回 BAD/GOOD 锚点，验删例结论在 live 链是否成立", _build_live_draft_with_examples),
}

BOOK_VARIANTS: dict[str, dict[str, BookVariant]] = {
    "draft": DRAFT_VARIANTS,
    "critique": CRITIQUE_VARIANTS,
    "revision": REVISION_VARIANTS,
    "live-draft": LIVE_DRAFT_VARIANTS,
}
