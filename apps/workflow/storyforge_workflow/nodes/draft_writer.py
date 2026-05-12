from __future__ import annotations

from storyforge_workflow.state import GenerationState, advance_status


def create_draft_excerpt(state: GenerationState) -> dict:
    """Draft Writer 只基于 Scene Packet 和 beats 生成片段。"""

    scene_packet = state["scene_packet"]
    beats = state["scene_beats"]
    protagonist = scene_packet.get("protagonist", "主角")
    scene_goal = scene_packet.get("scene_goal", beats[0]["content"])
    required_facts = "、".join(scene_packet.get("required_facts", [])) or "关键事实"
    draft = (
        f"{protagonist}站在场景入口，目标很明确：{scene_goal} "
        f"他必须记住{required_facts}。"
        f"当阻力逼近时，{beats[1]['content']}"
        f"最后，{beats[2]['content']}"
    )
    return {
        "draft_excerpt": draft,
        "current_status": "draft_created",
        "status_history": advance_status(state, "draft_created"),
        "current_node": "draft_writer",
    }
