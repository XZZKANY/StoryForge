from __future__ import annotations

from storyforge_workflow.state import GenerationState, advance_status


def create_book_strategy(state: GenerationState) -> dict:
    """Book Director 只负责把前提转为全书策略。"""

    premise = state["premise"]
    user_intent = state.get("user_intent", "")
    strategy = {
        "title_hint": "星海纪元",
        "premise": premise,
        "central_question": f"角色如何回应：{premise}",
        "reader_promise": user_intent or "保持清晰的成长线和冲突线。",
        "tone": "克制、具画面感、重视连续性",
    }
    return {
        "book_strategy": strategy,
        "current_status": "outline_created",
        "status_history": advance_status(state, "outline_created"),
        "current_node": "book_director",
    }
