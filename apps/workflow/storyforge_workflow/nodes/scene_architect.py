from __future__ import annotations

from storyforge_workflow.prompts import build_chapter_plan_prompt, build_scene_beats_prompt
from storyforge_workflow.prompts.context import narrative_context_from_state
from storyforge_workflow.provider_client import generate_text, planning_model, planning_temperature
from storyforge_workflow.state import GenerationState, advance_status


def create_chapter_plan(state: GenerationState) -> dict:
    """Scene Architect 只产出章节引用摘要，避免保存完整章节计划。"""

    chapter_title = str(state.get("chapter_title_ref", "第一章：启航"))
    chapter_goal = str(state.get("chapter_goal_ref") or state.get("strategy_question_ref", "完成章节目标。"))
    prompt = build_chapter_plan_prompt(narrative_context_from_state(state))
    raw = generate_text(prompt, temperature=planning_temperature(), model=planning_model())
    lines = [line.strip(" -：:") for line in raw.splitlines() if line.strip()]
    return {
        "chapter_title_ref": lines[0] if lines else chapter_title,
        "chapter_goal_ref": lines[1] if len(lines) > 1 else chapter_goal,
        "conflict_axis_ref": lines[2] if len(lines) > 2 else "外部任务压力与角色隐秘状态互相挤压",
        "current_status": "chapter_plan_created",
        "status_history": advance_status(state, "chapter_plan_created"),
        "current_node": "scene_architect.chapter_plan",
    }


def create_scene_beats(state: GenerationState) -> dict:
    """场景步骤只保存轻量 beat 摘要，后续正文进入 artifact。"""

    prompt = build_scene_beats_prompt(narrative_context_from_state(state))
    raw = generate_text(prompt, temperature=planning_temperature(), model=planning_model())
    beat_summaries = [line.strip(" -：:") for line in raw.splitlines() if line.strip()][:3]
    if not beat_summaries:
        raise RuntimeError("LLM 未返回可用场景 beat。")
    return {
        "scene_beat_refs": beat_summaries,
        "current_status": "scene_beats_created",
        "status_history": advance_status(state, "scene_beats_created"),
        "current_node": "scene_architect.scene_beats",
    }
