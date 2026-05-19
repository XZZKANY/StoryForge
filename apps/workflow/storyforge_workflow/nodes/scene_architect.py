from __future__ import annotations

from storyforge_workflow.state import GenerationState, advance_status


def create_chapter_plan(state: GenerationState) -> dict:
    """Scene Architect 只产出章节引用摘要，避免保存完整章节计划。"""

    chapter_title = str(state.get("chapter_title_ref", "第一章：启航"))
    chapter_goal = str(state.get("chapter_goal_ref") or state.get("strategy_question_ref", "完成章节目标。"))
    return {
        "chapter_title_ref": chapter_title,
        "chapter_goal_ref": chapter_goal,
        "conflict_axis_ref": "外部任务压力与角色隐秘状态互相挤压",
        "current_status": "chapter_plan_created",
        "status_history": advance_status(state, "chapter_plan_created"),
        "current_node": "scene_architect.chapter_plan",
    }


def create_scene_beats(state: GenerationState) -> dict:
    """场景步骤只保存轻量 beat 摘要，后续正文进入 artifact。"""

    scene_goal = str(state.get("scene_goal_ref", "完成关键场景目标。"))
    beat_summaries = [
        f"建立目标：{scene_goal}",
        "施加阻力：连续性约束迫使角色做出取舍。",
        "留下钩子：场景末尾保留下一章可继承的疑问。",
    ]
    return {
        "scene_beat_refs": beat_summaries,
        "current_status": "scene_beats_created",
        "status_history": advance_status(state, "scene_beats_created"),
        "current_node": "scene_architect.scene_beats",
    }
