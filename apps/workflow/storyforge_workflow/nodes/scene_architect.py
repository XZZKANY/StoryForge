from __future__ import annotations

from storyforge_workflow.prompts import build_chapter_plan_prompt, build_scene_beats_prompt
from storyforge_workflow.prompts.context import narrative_context_from_state
from storyforge_workflow.provider_client import generate_text, planning_model, planning_temperature
from storyforge_workflow.state import GenerationState, advance_status
from storyforge_workflow.utils.logging import get_logger

log = get_logger("storyforge_workflow.nodes.scene_architect")


def create_chapter_plan(state: GenerationState) -> dict:
    """Scene Architect 只产出章节引用摘要，避免保存完整章节计划。"""

    prompt = build_chapter_plan_prompt(narrative_context_from_state(state))
    raw = generate_text(prompt, temperature=planning_temperature(), model=planning_model())
    lines = [line.strip(" -：:") for line in raw.splitlines() if line.strip()]
    if len(lines) < 3:
        log.warning("chapter_plan_malformed_output", line_count=len(lines))
        raise RuntimeError("Chapter Plan 输出结构无效：需要章节标题、章节目标和冲突轴三行。")
    return {
        "chapter_title_ref": lines[0],
        "chapter_goal_ref": lines[1],
        "conflict_axis_ref": lines[2],
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
