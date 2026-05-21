from __future__ import annotations

from storyforge_workflow.state import GenerationState, advance_status
from storyforge_workflow.provider_client import generate_text


def create_book_strategy(state: GenerationState) -> dict:
    """Book Director 只写入策略引用摘要，不把完整策略塞入 checkpoint。"""

    premise = state["premise"]
    user_intent = state.get("user_intent", "")
    prompt = (
        "请为 StoryForge 生成一个简洁的作品策略标题、核心问题、语气和读者承诺。\n"
        f"故事前提：{premise}\n用户意图：{user_intent or '未提供'}\n"
        "输出四行，依次为标题、核心问题、语气、读者承诺。"
    )
    lines = [line.strip(" -：:") for line in generate_text(prompt).splitlines() if line.strip()]
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
