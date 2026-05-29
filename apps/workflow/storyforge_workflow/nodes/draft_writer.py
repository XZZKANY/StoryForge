from __future__ import annotations

from hashlib import sha1

from storyforge_workflow.prompts import (
    build_critique_prompt,
    build_draft_prompt,
    build_revision_prompt,
)
from storyforge_workflow.prompts.context import narrative_context_from_state
from storyforge_workflow.provider_client import draft_model, draft_temperature, generate_text
from storyforge_workflow.state import GenerationState, advance_status

# critic 判定"通过"的哨兵：见到即视为无问题，结束评审环。
_CRITIQUE_PASS_TOKEN = "通过"


def create_draft_excerpt(state: GenerationState) -> dict:
    """Draft Writer 只返回草稿制品引用和短预览，不把完整草稿塞入 checkpoint。"""

    scene_goal = str(state.get("scene_goal_ref", "完成关键场景目标。"))
    beat_refs = state.get("scene_beat_refs", ["建立目标", "施加阻力", "留下钩子"])
    prompt = build_draft_prompt(narrative_context_from_state(state))
    draft_preview = generate_text(prompt, temperature=draft_temperature(), model=draft_model())
    artifact_seed = "|".join([state["job_run_id"], scene_goal, *[str(beat) for beat in beat_refs]])
    return {
        "draft_artifact_id": int(sha1(artifact_seed.encode("utf-8")).hexdigest()[:8], 16),
        "draft_preview_ref": draft_preview,
        "draft_revision_round": 0,
        "current_status": "draft_created",
        "status_history": advance_status(state, "draft_created"),
        "current_node": "draft_writer",
    }


def create_draft_critique(state: GenerationState) -> dict:
    """Draft Critic：对照全量约束自检当前草稿，产出问题清单（空表示通过）。"""

    draft = str(state.get("draft_preview_ref", ""))
    prompt = build_critique_prompt(narrative_context_from_state(state), draft)
    raw = generate_text(prompt, temperature=0)
    issues = _parse_issues(raw)
    return {
        "draft_issues": issues,
        "current_node": "draft_critic",
    }


def create_draft_revision(state: GenerationState) -> dict:
    """Draft Reviser：按问题清单定点重写草稿，递增重写轮数。"""

    draft = str(state.get("draft_preview_ref", ""))
    issues = list(state.get("draft_issues", []))
    prompt = build_revision_prompt(narrative_context_from_state(state), draft, issues)
    revised = generate_text(prompt, temperature=draft_temperature(), model=draft_model())
    return {
        "draft_preview_ref": revised,
        "draft_revision_round": int(state.get("draft_revision_round", 0)) + 1,
        "current_node": "draft_reviser",
    }


def _parse_issues(raw: str) -> list[str]:
    """把 critic 输出解析为问题行列表；命中通过哨兵或无内容则返回空列表。"""

    lines = [line.strip(" -：:") for line in raw.splitlines() if line.strip()]
    if not lines:
        return []
    if len(lines) == 1 and lines[0].startswith(_CRITIQUE_PASS_TOKEN):
        return []
    return [line for line in lines if not line.startswith(_CRITIQUE_PASS_TOKEN)]
