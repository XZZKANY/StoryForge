from __future__ import annotations

from storyforge_workflow.prompts import build_strategy_prompt
from storyforge_workflow.prompts.context import narrative_context_from_state
from storyforge_workflow.provider_client import generate_text, planning_model, planning_temperature
from storyforge_workflow.state import GenerationState, advance_status


def create_book_strategy(state: GenerationState) -> dict:
    """Book Director 只写入策略引用摘要，不把完整策略塞入 checkpoint。"""

    premise = state["premise"]
    user_intent = state.get("user_intent", "")
    prompt = build_strategy_prompt(narrative_context_from_state(state))
    raw = generate_text(prompt, temperature=planning_temperature(), model=planning_model())
    lines = [line.strip(" -：:") for line in raw.splitlines() if line.strip()]
    central_question = lines[1] if len(lines) > 1 else f"角色如何回应：{premise}"
    return {
        "strategy_title_ref": lines[0] if lines else premise[:24],
        "strategy_question_ref": central_question,
        "strategy_tone_ref": lines[2] if len(lines) > 2 else "克制、具画面感、重视连续性",
        "strategy_reader_promise_ref": lines[3] if len(lines) > 3 else user_intent or "保持清晰的成长线和冲突线。",
        "current_status": "outline_created",
        "status_history": advance_status(state, "outline_created"),
        "current_node": "book_director",
    }
