from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock
from time import perf_counter
from typing import Any

from storyforge_workflow.orchestrators.book_loop_types import BookLoopRequest, BookLoopResult
from storyforge_workflow.orchestrators.chapter_scheduler import (
    ChapterScheduleContext,
    ChapterScheduleDecision,
)
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


def _fill_chapter_window(
    executor: ThreadPoolExecutor,
    run_chapter: Callable[[int], NovelLoopResult],
    request: BookLoopRequest,
    next_schedule_index: int,
    futures: dict[Future[NovelLoopResult], int],
    schedule_decisions: list[dict[str, Any]],
) -> int:
    if next_schedule_index > request.total_chapters:
        return next_schedule_index
    decision = _chapter_window_decision(request, next_schedule_index)
    _record_schedule_decision(schedule_decisions, next_schedule_index, decision)
    while len(futures) < decision.window_size and next_schedule_index <= request.total_chapters:
        futures[executor.submit(run_chapter, next_schedule_index)] = next_schedule_index
        next_schedule_index += 1
    return next_schedule_index


class _ParallelRuntimeTracker:
    """记录章节 worker 实际运行区间，用于计算真实重叠利用率。"""

    def __init__(self) -> None:
        self._lock = Lock()
        self._intervals: list[tuple[float, float]] = []

    def wrap(self, run_chapter: Callable[[int], NovelLoopResult]) -> Callable[[int], NovelLoopResult]:
        def tracked(chapter_index: int) -> NovelLoopResult:
            started_at = perf_counter()
            try:
                return run_chapter(chapter_index)
            finally:
                ended_at = perf_counter()
                with self._lock:
                    self._intervals.append((started_at, ended_at))

        return tracked

    def metrics(self, target_window: int) -> dict[str, Any]:
        with self._lock:
            intervals = list(self._intervals)
        if not intervals:
            return {
                "parallel_runtime_wall_sec": 0.0,
                "parallel_worker_busy_sec": 0.0,
                "parallel_runtime_utilization": 0.0,
            }
        first_start = min(start for start, _end in intervals)
        last_end = max(end for _start, end in intervals)
        wall_seconds = max(0.0, last_end - first_start)
        busy_seconds = sum(max(0.0, end - start) for start, end in intervals)
        denominator = wall_seconds * max(1, target_window)
        utilization = 0.0 if denominator <= 0 else max(0.0, min(1.0, busy_seconds / denominator))
        return {
            "parallel_runtime_wall_sec": round(wall_seconds, 4),
            "parallel_worker_busy_sec": round(busy_seconds, 4),
            "parallel_runtime_utilization": round(utilization, 4),
        }


def _parallelism_enabled(request: BookLoopRequest) -> bool:
    if request.chapter_parallelism <= 1:
        return False
    return request.chapter_budget is None


def _preemptive_pause_enabled(request: BookLoopRequest) -> bool:
    return (
        request.token_budget is not None
        or request.time_budget_sec is not None
        or request.provider_fallback_pause_threshold is not None
    )


def _chapter_window_decision(request: BookLoopRequest, next_chapter_index: int) -> ChapterScheduleDecision:
    return ChapterScheduleContext(
        total_chapters=request.total_chapters,
        next_chapter_index=next_chapter_index,
        requested_parallelism=request.chapter_parallelism,
        require_prior_chapter_commit_before_start=request.require_prior_chapter_commit_before_start,
        require_budget_guard_before_prefetch=request.require_budget_guard_before_prefetch,
        has_preemptive_budget_or_pause_guard=_preemptive_pause_enabled(request),
    ).decide()


def _record_schedule_decision(
    schedule_decisions: list[dict[str, Any]],
    next_chapter_index: int,
    decision: ChapterScheduleDecision,
) -> None:
    entry = {
        "next_chapter_index": next_chapter_index,
        "phase": decision.phase,
        "target_window": decision.window_size,
        "actual_window": decision.window_size,
    }
    if not schedule_decisions or schedule_decisions[-1] != entry:
        schedule_decisions.append(entry)


def _with_integration_metrics(result: BookLoopResult, metrics: dict[str, Any]) -> BookLoopResult:
    progress = dict(result.progress)
    progress["integration_metrics"] = metrics
    return BookLoopResult(status=result.status, current_chapter_index=result.current_chapter_index, progress=progress)


def _parallel_integration_metrics(
    request: BookLoopRequest,
    max_in_flight: int,
    runtime_tracker: _ParallelRuntimeTracker,
    precommit_revision_count: int = 0,
    schedule_decisions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    schedule_decisions = _with_phase_boundary_decisions(request, list(schedule_decisions or []))
    target_window = _chapter_window_decision(request, request.start_chapter_index).window_size
    runtime_metrics = runtime_tracker.metrics(target_window)
    metrics = {
        "concurrent_chapter_utilization": runtime_metrics["parallel_runtime_utilization"],
        "metric_scope": "workflow_book_loop_parallel_runtime_overlap",
        "chapter_parallelism": request.chapter_parallelism,
        "max_in_flight_chapters": max_in_flight,
        "target_parallel_window": target_window,
        "chapter_schedule_windows": schedule_decisions,
        "phase_aware_parallel_windows": _phase_window_summary(schedule_decisions),
        **runtime_metrics,
    }
    if request.require_prior_chapter_commit_before_start:
        metrics["dependency_mode"] = "prior_chapter_commit"
    if request.require_budget_guard_before_prefetch and _preemptive_pause_enabled(request):
        metrics["prefetch_mode"] = "budget_guarded"
    if precommit_revision_count:
        metrics["dependency_mode"] = "precommit_revision"
        metrics["chapter_correction_count"] = precommit_revision_count
    return metrics


def _with_phase_boundary_decisions(
    request: BookLoopRequest,
    schedule_decisions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_index = {
        decision["next_chapter_index"]: dict(decision)
        for decision in schedule_decisions
        if isinstance(decision.get("next_chapter_index"), int)
    }
    for chapter_index in _phase_boundary_indexes(request):
        decision = _chapter_window_decision(request, chapter_index)
        by_index.setdefault(
            chapter_index,
            {
                "next_chapter_index": chapter_index,
                "phase": decision.phase,
                "target_window": decision.window_size,
                "actual_window": decision.window_size,
            },
        )
    return [by_index[index] for index in sorted(by_index)]


def _phase_boundary_indexes(request: BookLoopRequest) -> list[int]:
    total = max(1, request.total_chapters)
    candidates = [
        request.start_chapter_index,
        int(total * 0.5) + 1,
        int(total * 0.8) + 1,
    ]
    return [index for index in candidates if request.start_chapter_index <= index <= request.total_chapters]


def _phase_window_summary(schedule_decisions: list[dict[str, Any]]) -> dict[str, int]:
    summary: dict[str, int] = {}
    for decision in schedule_decisions:
        phase = decision.get("phase")
        window = decision.get("target_window")
        if isinstance(phase, str) and isinstance(window, int):
            summary[phase] = max(summary.get(phase, 0), window)
    return summary
