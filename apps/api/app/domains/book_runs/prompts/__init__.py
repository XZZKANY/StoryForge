"""StoryForge prompt 工程层。

纯函数构建器，把结构化创作约束（角色、风格、节奏、连续性）组装成分层 prompt。
不读数据库、不调用模型；数据由调用方（节点 / API adapter）注入，保持 workflow 与 API 真相源边界清晰。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.domains.book_runs.prompts.builder import (
    build_chapter_plan_prompt,
    build_continuity_edges_prompt,
    build_critique_prompt,
    build_draft_prompt,
    build_longform_segment_prompt,
    build_revision_prompt,
    build_scene_beats_prompt,
    build_strategy_prompt,
)
from app.domains.book_runs.prompts.context import narrative_context_from_state


def build_draft_prompt_from_state(
    state: Mapping[str, Any],
    *,
    preview_chars: int = 120,
    full_chapter: bool = False,
) -> str:
    """把注入键字典编译成可批准正文的分层 prompt。

    full_chapter=True 时要求按字数目标写完整一章，而非开头预览。
    """

    ctx = narrative_context_from_state(dict(state))
    return build_draft_prompt(ctx, preview_chars=preview_chars, full_chapter=full_chapter)


__all__ = [
    "build_strategy_prompt",
    "build_chapter_plan_prompt",
    "build_scene_beats_prompt",
    "build_draft_prompt",
    "build_draft_prompt_from_state",
    "build_longform_segment_prompt",
    "build_critique_prompt",
    "build_revision_prompt",
    "build_continuity_edges_prompt",
]
