from __future__ import annotations

from storyforge_workflow.prompts import build_strategy_prompt
from storyforge_workflow.prompts.context import narrative_context_from_state
from storyforge_workflow.provider_client import generate_text, planning_model, planning_temperature
from storyforge_workflow.state import GenerationState, advance_status
from storyforge_workflow.utils.logging import get_logger

log = get_logger("storyforge_workflow.nodes.director")


def create_book_strategy(state: GenerationState) -> dict:
    """Book Director 只写入策略引用摘要，不把完整策略塞入 checkpoint。"""

    prompt = build_strategy_prompt(narrative_context_from_state(state))
    raw = generate_text(prompt, temperature=planning_temperature(), model=planning_model())
    lines = [line.strip(" -：:") for line in raw.splitlines() if line.strip()]
    if len(lines) < 4:
        log.warning("book_director_malformed_output", line_count=len(lines))
        raise RuntimeError("Book Director 输出结构无效：需要标题、核心问题、语气和读者承诺四行。")
    central_question = lines[1]
    return {
        "strategy_title_ref": lines[0],
        "strategy_question_ref": central_question,
        "strategy_tone_ref": lines[2],
        "strategy_reader_promise_ref": lines[3],
        "current_status": "outline_created",
        "status_history": advance_status(state, "outline_created"),
        "current_node": "book_director",
    }
