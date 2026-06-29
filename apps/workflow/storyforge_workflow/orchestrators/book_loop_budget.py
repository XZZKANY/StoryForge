from __future__ import annotations

from typing import Any

from storyforge_workflow.orchestrators._coercion import _positive_float_or_zero, _positive_int_or_zero
from storyforge_workflow.orchestrators.book_loop_types import BookLoopRequest, BookLoopResult
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


def _initial_budget(checkpoint: list[dict[str, Any]]) -> dict[str, int | float]:
    return {
        "tokens_used": sum(_int_value(item.get("token_usage")) for item in checkpoint),
        "elapsed_time_sec": sum(_int_value(item.get("elapsed_time_sec")) for item in checkpoint),
        "estimated_cost": sum(_float_value(item.get("cost_estimate")) for item in checkpoint),
    }


def _accumulate_budget(budget: dict[str, int | float], result: NovelLoopResult) -> None:
    budget["tokens_used"] = _int_value(budget["tokens_used"]) + result.token_usage
    budget["elapsed_time_sec"] = _int_value(budget["elapsed_time_sec"]) + result.elapsed_time_sec
    budget["estimated_cost"] = _float_value(budget["estimated_cost"]) + result.cost_estimate


def _budget_pause_reason(request: BookLoopRequest, budget: dict[str, int | float]) -> str | None:
    if request.token_budget is not None and _int_value(budget["tokens_used"]) >= request.token_budget:
        return "token_budget_exceeded"
    if request.time_budget_sec is not None and _int_value(budget["elapsed_time_sec"]) >= request.time_budget_sec:
        return "time_budget_exceeded"
    return None


def _paused_by_budget(
    chapter_index: int,
    completed: list[dict[str, Any]],
    checkpoint: list[dict[str, Any]],
    budget: dict[str, int | float],
    reason: str,
) -> BookLoopResult:
    return BookLoopResult(
        status="paused_by_budget",
        current_chapter_index=chapter_index,
        progress={
            "completed_chapters": completed,
            "checkpoint": checkpoint,
            "budget": dict(budget),
            "pause_reason": reason,
        },
    )


def _provider_degradation_result(
    chapter_index: int,
    completed: list[dict[str, Any]],
    checkpoint: list[dict[str, Any]],
    budget: dict[str, int | float],
    consecutive_fallbacks: int,
    chapter_result: NovelLoopResult,
) -> BookLoopResult:
    return BookLoopResult(
        status="paused_by_provider_degradation",
        current_chapter_index=chapter_index,
        progress={
            "completed_chapters": completed,
            "checkpoint": checkpoint,
            "budget": dict(budget),
            "provider_degradation": {
                "consecutive_fallbacks": consecutive_fallbacks,
                "latest_fallback": chapter_result.fallback_metadata,
            },
        },
    )


def _fallback_limit_reached(request: BookLoopRequest, consecutive_fallbacks: int) -> bool:
    threshold = request.provider_fallback_pause_threshold
    return threshold is not None and threshold > 0 and consecutive_fallbacks >= threshold


def _int_value(value: object) -> int:
    return _positive_int_or_zero(value)


def _float_value(value: object) -> float:
    return _positive_float_or_zero(value)
