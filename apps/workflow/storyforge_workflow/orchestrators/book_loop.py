from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


@dataclass(frozen=True)
class BookLoopRequest:
    """BookLoop 的最小输入，对应 API 侧 BookRun。"""

    book_run_id: int
    book_id: int
    blueprint_id: int
    total_chapters: int
    start_chapter_index: int = 1
    existing_checkpoint: list[dict[str, Any]] = field(default_factory=list)
    token_budget: int | None = None
    time_budget_sec: int | None = None
    chapter_budget: int | None = None
    provider_fallback_pause_threshold: int | None = None


@dataclass(frozen=True)
class BookLoopResult:
    """BookLoop 运行结果，可直接回填 BookRun progress。"""

    status: str
    current_chapter_index: int
    progress: dict[str, Any] = field(default_factory=dict)


def run_book_loop(
    request: BookLoopRequest,
    run_chapter: Callable[[int], NovelLoopResult],
) -> BookLoopResult:
    """顺序驱动每章 NovelLoop，按 checkpoint、预算和 provider 降级约束暂停。"""

    completed = list(request.existing_checkpoint)
    checkpoint = list(request.existing_checkpoint)
    budget = _initial_budget(completed)
    consecutive_fallbacks = 0
    for chapters_started, chapter_index in enumerate(
        range(request.start_chapter_index, request.total_chapters + 1)
    ):
        if request.chapter_budget is not None and chapters_started >= request.chapter_budget:
            return _paused_by_budget(chapter_index, completed, checkpoint, budget, "chapter_budget_exceeded")
        chapter_result = run_chapter(chapter_index)
        _accumulate_budget(budget, chapter_result)
        if chapter_result.status != "approved":
            return BookLoopResult(
                status="awaiting_review",
                current_chapter_index=chapter_index,
                progress={
                    "completed_chapters": completed,
                    "checkpoint": checkpoint,
                    "blocked_chapter": _chapter_progress(chapter_index, chapter_result),
                    "budget": dict(budget),
                },
            )
        chapter_progress = _chapter_progress(chapter_index, chapter_result)
        completed.append(chapter_progress)
        checkpoint.append(_checkpoint_entry(chapter_progress))
        if chapter_result.fallback_metadata:
            consecutive_fallbacks += 1
        else:
            consecutive_fallbacks = 0
        if _fallback_limit_reached(request, consecutive_fallbacks):
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
        pause_reason = _budget_pause_reason(request, budget)
        if pause_reason is not None:
            return _paused_by_budget(chapter_index, completed, checkpoint, budget, pause_reason)
    return BookLoopResult(
        status="completed",
        current_chapter_index=request.total_chapters,
        progress={"completed_chapters": completed, "checkpoint": checkpoint, "budget": dict(budget)},
    )


def _chapter_progress(chapter_index: int, result: NovelLoopResult) -> dict[str, Any]:
    return {
        "chapter_index": chapter_index,
        "status": result.status,
        "model_run_id": result.source_model_run_id,
        "judge_report_id": result.judge_report_id,
        "repair_patch_id": result.repair_patch_id,
        "approved_scene_id": result.approved_scene_id,
        "token_usage": result.token_usage,
        "elapsed_time_sec": result.elapsed_time_sec,
        "cost_estimate": result.cost_estimate,
        "fallback_metadata": result.fallback_metadata,
        "skill_runs": list(result.skill_runs),
    }


def _checkpoint_entry(chapter_progress: dict[str, Any]) -> dict[str, Any]:
    return {
        "chapter_index": chapter_progress["chapter_index"],
        "model_run_id": chapter_progress["model_run_id"],
        "judge_report_id": chapter_progress["judge_report_id"],
        "approved_scene_id": chapter_progress["approved_scene_id"],
    }


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


def _fallback_limit_reached(request: BookLoopRequest, consecutive_fallbacks: int) -> bool:
    threshold = request.provider_fallback_pause_threshold
    return threshold is not None and threshold > 0 and consecutive_fallbacks >= threshold


def _int_value(value: object) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def _float_value(value: object) -> float:
    return float(value) if isinstance(value, int | float) and value > 0 else 0.0
