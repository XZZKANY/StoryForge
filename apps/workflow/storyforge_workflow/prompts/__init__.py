"""StoryForge prompt 工程层。

纯函数构建器，把结构化创作约束（角色、风格、节奏、连续性）组装成分层 prompt。
不读数据库、不调用模型；数据由调用方（节点 / API adapter）注入，保持 workflow 与 API 真相源边界清晰。
"""

from __future__ import annotations

from storyforge_workflow.prompts.builder import (
    build_chapter_plan_prompt,
    build_critique_prompt,
    build_draft_prompt,
    build_longform_segment_prompt,
    build_revision_prompt,
    build_scene_beats_prompt,
    build_strategy_prompt,
)

__all__ = [
    "build_strategy_prompt",
    "build_chapter_plan_prompt",
    "build_scene_beats_prompt",
    "build_draft_prompt",
    "build_longform_segment_prompt",
    "build_critique_prompt",
    "build_revision_prompt",
]
