from __future__ import annotations

from hashlib import sha1

from storyforge_workflow.state import GenerationState, advance_status


def create_draft_excerpt(state: GenerationState) -> dict:
    """Draft Writer 只返回草稿制品引用和短预览，不把完整草稿塞入 checkpoint。"""

    protagonist = str(state.get("protagonist_ref", "主角"))
    scene_goal = str(state.get("scene_goal_ref", "完成关键场景目标。"))
    required_facts = "、".join(state.get("required_fact_refs", [])) or "关键事实"
    beat_refs = state.get("scene_beat_refs", ["建立目标", "施加阻力", "留下钩子"])
    draft_preview = f"{protagonist}站在场景入口，目标很明确：{scene_goal} 他必须记住{required_facts}。"
    artifact_seed = "|".join([state["job_run_id"], scene_goal, *[str(beat) for beat in beat_refs]])
    return {
        "draft_artifact_id": int(sha1(artifact_seed.encode("utf-8")).hexdigest()[:8], 16),
        "draft_preview_ref": draft_preview,
        "current_status": "draft_created",
        "status_history": advance_status(state, "draft_created"),
        "current_node": "draft_writer",
    }
