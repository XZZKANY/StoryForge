"""Prompt builder for narrative scene fact extraction."""

from __future__ import annotations

from storyforge_workflow.prompts.models import NarrativeContext


def build_narrative_fact_extract_prompt(
    ctx: NarrativeContext, draft: str, *, chapter: int
) -> str:
    return "\n".join(
        [
            "Return only a valid JSON object. No markdown fences, no commentary.",
            "",
            "## 任务",
            "从章节正文中抽取叙事事实，用于后续判断场景是否推动了关系、线索和不可逆后果。",
            "",
            "## 章节位置",
            f"chapter: {chapter}",
            f"chapter_title: {ctx.chapter_title}",
            f"scene_goal: {ctx.scene_goal}",
            "",
            "## 待抽取正文",
            draft,
            "",
            "## 输出 JSON 字段",
            '- "chapter": int',
            '- "primary_scene_mode": string',
            '- "action_sequence": array of strings',
            '- "conflict_type": string',
            '- "protagonist_mistake": string',
            '- "cost": string',
            '- "relationship_delta": string',
            '- "irreversible_consequence": string',
            '- "clue_usage_mode": string',
            '- "new_evidence": array of strings',
            '- "existing_clues_reinterpreted": array of strings',
            '- "deletable": boolean true/false',
        ]
    )
