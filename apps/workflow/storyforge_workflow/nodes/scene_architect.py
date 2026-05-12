from __future__ import annotations

from storyforge_workflow.state import GenerationState, advance_status


def create_chapter_plan(state: GenerationState) -> dict:
    """Scene Architect 的章节规划步骤只产出章节计划。"""

    strategy = state["book_strategy"]
    scene_packet = state["scene_packet"]
    chapter_plan = {
        "chapter_title": scene_packet.get("chapter_title", "第一章：启航"),
        "chapter_goal": scene_packet.get("chapter_goal", strategy["central_question"]),
        "conflict_axis": "外部任务压力与角色隐秘状态互相挤压",
        "required_facts": list(scene_packet.get("required_facts", [])),
    }
    return {
        "chapter_plan": chapter_plan,
        "current_status": "chapter_plan_created",
        "status_history": advance_status(state, "chapter_plan_created"),
        "current_node": "scene_architect.chapter_plan",
    }


def create_scene_beats(state: GenerationState) -> dict:
    """Scene Architect 的场景步骤只产出 scene beats。"""

    scene_packet = state["scene_packet"]
    scene_goal = scene_packet.get("scene_goal", "完成关键场景目标。")
    beats = [
        {"order": 1, "purpose": "建立目标", "content": scene_goal},
        {"order": 2, "purpose": "施加阻力", "content": "连续性约束迫使角色做出取舍。"},
        {"order": 3, "purpose": "留下钩子", "content": "场景末尾保留下一章可继承的疑问。"},
    ]
    return {
        "scene_beats": beats,
        "current_status": "scene_beats_created",
        "status_history": advance_status(state, "scene_beats_created"),
        "current_node": "scene_architect.scene_beats",
    }
