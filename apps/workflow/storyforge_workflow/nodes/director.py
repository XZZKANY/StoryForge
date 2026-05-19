from __future__ import annotations

from storyforge_workflow.state import GenerationState, advance_status


def create_book_strategy(state: GenerationState) -> dict:
    """Book Director 只写入策略引用摘要，不把完整策略塞入 checkpoint。"""

    premise = state["premise"]
    user_intent = state.get("user_intent", "")
    central_question = f"角色如何回应：{premise}"
    return {
        "strategy_title_ref": "星海纪元",
        "strategy_question_ref": central_question,
        "strategy_tone_ref": "克制、具画面感、重视连续性",
        "strategy_reader_promise_ref": user_intent or "保持清晰的成长线和冲突线。",
        "current_status": "outline_created",
        "status_history": advance_status(state, "outline_created"),
        "current_node": "book_director",
    }
