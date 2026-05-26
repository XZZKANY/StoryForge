from __future__ import annotations

from storyforge_workflow.provider_client import generate_text
from storyforge_workflow.state import GenerationState, advance_status


def create_chapter_plan(state: GenerationState) -> dict:
    """Scene Architect 只产出章节引用摘要，避免保存完整章节计划。"""

    chapter_title = str(state.get("chapter_title_ref", "第一章：启航"))
    chapter_goal = str(state.get("chapter_goal_ref") or state.get("strategy_question_ref", "完成章节目标。"))
    prompt = (
        "请根据作品策略生成章节计划，输出三行：章节标题、章节目标、冲突轴。\n"
        f"核心问题：{state.get('strategy_question_ref', '')}\n"
        f"场景包编号：{state.get('scene_packet_id', 0)}"
    )
    lines = [line.strip(" -：:") for line in generate_text(prompt).splitlines() if line.strip()]
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

    scene_goal = str(state.get("scene_goal_ref", "完成关键场景目标。"))
    prompt = (
        "请为小说场景生成三条动作 beat，每条一行，必须贴合场景目标和连续性约束。\n"
        f"场景目标：{scene_goal}\n"
        f"章节目标：{state.get('chapter_goal_ref', '')}\n"
        f"必含事实：{'、'.join(state.get('required_fact_refs', []))}"
    )
    beat_summaries = [line.strip(" -：:") for line in generate_text(prompt).splitlines() if line.strip()][:3]
    if not beat_summaries:
        raise RuntimeError("LLM 未返回可用场景 beat。")
    return {
        "scene_beat_refs": beat_summaries,
        "current_status": "scene_beats_created",
        "status_history": advance_status(state, "scene_beats_created"),
        "current_node": "scene_architect.scene_beats",
    }
