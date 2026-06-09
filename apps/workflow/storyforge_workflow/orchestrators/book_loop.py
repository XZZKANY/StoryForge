from __future__ import annotations

from collections.abc import Callable, Iterator
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from threading import Lock
from time import perf_counter
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
    chapter_parallelism: int = 1
    require_prior_chapter_commit_before_start: bool = False
    require_budget_guard_before_prefetch: bool = False


@dataclass(frozen=True)
class BookLoopResult:
    """BookLoop 运行结果，可直接回填 BookRun progress。"""

    status: str
    current_chapter_index: int
    progress: dict[str, Any] = field(default_factory=dict)


class ChapterExecutionError(RuntimeError):
    """章节并发执行失败时携带精确章节号，供 adapter 生成失败回填。"""

    def __init__(self, chapter_index: int, original: Exception) -> None:
        super().__init__(str(original))
        self.chapter_index = chapter_index
        self.original = original


@dataclass(frozen=True)
class ChapterConsistencyReport:
    """跨章一致性屏障的判定结果。conflicts 非空即视为冲突，阻断后续章节。"""

    conflicts: list[dict[str, Any]] = field(default_factory=list)

    @property
    def has_conflict(self) -> bool:
        return bool(self.conflicts)


# 屏障入参：待提交章节号、该章结果、已按序提交的章节进度快照。
# 返回 None 视为通过；返回带 conflicts 的报告则阻断该章。
ConsistencyBarrier = Callable[[int, NovelLoopResult, list[dict[str, Any]]], ChapterConsistencyReport | None]
PrecommitChapter = Callable[[int, NovelLoopResult, list[dict[str, Any]]], NovelLoopResult]


def run_book_loop(
    request: BookLoopRequest,
    run_chapter: Callable[[int], NovelLoopResult],
    progress_callback: Callable[[BookLoopResult], None] | None = None,
    consistency_barrier: ConsistencyBarrier | None = None,
    precommit_chapter: PrecommitChapter | None = None,
) -> BookLoopResult:
    """顺序驱动每章 NovelLoop，按 checkpoint、预算和 provider 降级约束暂停。"""

    if _parallelism_enabled(request):
        return _run_book_loop_parallel(request, run_chapter, progress_callback, consistency_barrier, precommit_chapter)

    completed = list(request.existing_checkpoint)
    checkpoint = list(request.existing_checkpoint)
    budget = _initial_budget(completed)
    consecutive_fallbacks = 0
    for chapters_started, chapter_index in enumerate(range(request.start_chapter_index, request.total_chapters + 1)):
        if request.chapter_budget is not None and chapters_started >= request.chapter_budget:
            return _paused_by_budget(chapter_index, completed, checkpoint, budget, "chapter_budget_exceeded")
        try:
            chapter_result = run_chapter(chapter_index)
        except Exception as exc:
            raise ChapterExecutionError(chapter_index, exc) from exc
        chapter_result = _run_precommit_chapter(precommit_chapter, chapter_index, chapter_result, completed)
        _accumulate_budget(budget, chapter_result)
        consistency_report = _run_consistency_barrier(consistency_barrier, chapter_index, chapter_result, completed)
        if consistency_report is not None and consistency_report.has_conflict:
            return _consistency_blocked_result(chapter_index, chapter_result, completed, checkpoint, budget, consistency_report)
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
        if progress_callback is not None:
            progress_callback(
                BookLoopResult(
                    status="running",
                    current_chapter_index=chapter_index,
                    progress={
                        "completed_chapters": list(completed),
                        "checkpoint": list(checkpoint),
                        "budget": dict(budget),
                    },
                )
            )
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


def _run_book_loop_parallel(
    request: BookLoopRequest,
    run_chapter: Callable[[int], NovelLoopResult],
    progress_callback: Callable[[BookLoopResult], None] | None,
    consistency_barrier: ConsistencyBarrier | None = None,
    precommit_chapter: PrecommitChapter | None = None,
) -> BookLoopResult:
    """并发预取章节结果，但只按章节顺序提交 checkpoint 和 progress。"""

    completed = list(request.existing_checkpoint)
    checkpoint = list(request.existing_checkpoint)
    budget = _initial_budget(completed)
    pending_results: dict[int, NovelLoopResult] = {}
    futures: dict[Future[NovelLoopResult], int] = {}
    chapter_indexes = iter(range(request.start_chapter_index, request.total_chapters + 1))
    next_commit_index = request.start_chapter_index
    consecutive_fallbacks = 0
    max_in_flight = 0
    precommit_revision_count = 0
    runtime_tracker = _ParallelRuntimeTracker()
    tracked_run_chapter = runtime_tracker.wrap(run_chapter)

    executor = ThreadPoolExecutor(
        max_workers=max(1, request.chapter_parallelism),
        thread_name_prefix="storyforge-book-chapter",
    )
    executor_closed = False
    try:
        _fill_chapter_window(executor, tracked_run_chapter, chapter_indexes, futures, _chapter_window_size(request))
        max_in_flight = max(max_in_flight, len(futures))
        while futures or pending_results:
            while next_commit_index in pending_results:
                chapter_result = pending_results.pop(next_commit_index)
                if precommit_chapter is not None:
                    chapter_result = _run_precommit_chapter(
                        precommit_chapter, next_commit_index, chapter_result, completed
                    )
                    precommit_revision_count += 1
                _accumulate_budget(budget, chapter_result)
                consistency_report = _run_consistency_barrier(
                    consistency_barrier, next_commit_index, chapter_result, completed
                )
                if consistency_report is not None and consistency_report.has_conflict:
                    _shutdown_pending_chapters(executor, futures)
                    executor_closed = True
                    return _with_integration_metrics(
                        _consistency_blocked_result(
                            next_commit_index, chapter_result, completed, checkpoint, budget, consistency_report
                        ),
                        _parallel_integration_metrics(request, max_in_flight, runtime_tracker, precommit_revision_count),
                    )
                if chapter_result.status != "approved":
                    _shutdown_pending_chapters(executor, futures)
                    executor_closed = True
                    return _with_integration_metrics(
                        BookLoopResult(
                            status="awaiting_review",
                            current_chapter_index=next_commit_index,
                            progress={
                                "completed_chapters": completed,
                                "checkpoint": checkpoint,
                                "blocked_chapter": _chapter_progress(next_commit_index, chapter_result),
                                "budget": dict(budget),
                            },
                        ),
                        _parallel_integration_metrics(request, max_in_flight, runtime_tracker, precommit_revision_count),
                    )
                chapter_progress = _chapter_progress(next_commit_index, chapter_result)
                completed.append(chapter_progress)
                checkpoint.append(_checkpoint_entry(chapter_progress))
                if progress_callback is not None:
                    progress_callback(
                        _with_integration_metrics(
                            BookLoopResult(
                                status="running",
                                current_chapter_index=next_commit_index,
                                progress={
                                    "completed_chapters": list(completed),
                                    "checkpoint": list(checkpoint),
                                    "budget": dict(budget),
                                },
                            ),
                            _parallel_integration_metrics(request, max_in_flight, runtime_tracker, precommit_revision_count),
                        )
                    )
                if chapter_result.fallback_metadata:
                    consecutive_fallbacks += 1
                else:
                    consecutive_fallbacks = 0
                if _fallback_limit_reached(request, consecutive_fallbacks):
                    _shutdown_pending_chapters(executor, futures)
                    executor_closed = True
                    return _with_integration_metrics(
                        _provider_degradation_result(
                            next_commit_index, completed, checkpoint, budget, consecutive_fallbacks, chapter_result
                        ),
                        _parallel_integration_metrics(request, max_in_flight, runtime_tracker, precommit_revision_count),
                    )
                pause_reason = _budget_pause_reason(request, budget)
                if pause_reason is not None:
                    _shutdown_pending_chapters(executor, futures)
                    executor_closed = True
                    return _with_integration_metrics(
                        _paused_by_budget(next_commit_index, completed, checkpoint, budget, pause_reason),
                        _parallel_integration_metrics(request, max_in_flight, runtime_tracker, precommit_revision_count),
                    )
                next_commit_index += 1
            if not futures:
                _fill_chapter_window(executor, tracked_run_chapter, chapter_indexes, futures, _chapter_window_size(request))
                max_in_flight = max(max_in_flight, len(futures))
                if not futures:
                    break
            done, _ = wait(futures.keys(), return_when=FIRST_COMPLETED)
            for future in done:
                chapter_index = futures.pop(future)
                try:
                    pending_results[chapter_index] = future.result()
                except Exception as exc:
                    _shutdown_pending_chapters(executor, futures)
                    executor_closed = True
                    raise ChapterExecutionError(chapter_index, exc) from exc
            if not (_preemptive_pause_enabled(request) and pending_results):
                _fill_chapter_window(executor, tracked_run_chapter, chapter_indexes, futures, _chapter_window_size(request))
                max_in_flight = max(max_in_flight, len(futures))
    finally:
        if not executor_closed:
            executor.shutdown(wait=True)

    return _with_integration_metrics(
        BookLoopResult(
            status="completed",
            current_chapter_index=request.total_chapters,
            progress={"completed_chapters": completed, "checkpoint": checkpoint, "budget": dict(budget)},
        ),
        _parallel_integration_metrics(request, max_in_flight, runtime_tracker, precommit_revision_count),
    )


def _fill_chapter_window(
    executor: ThreadPoolExecutor,
    run_chapter: Callable[[int], NovelLoopResult],
    chapter_indexes: Iterator[int],
    futures: dict[Future[NovelLoopResult], int],
    chapter_parallelism: int,
) -> None:
    while len(futures) < chapter_parallelism:
        try:
            chapter_index = next(chapter_indexes)
        except StopIteration:
            return
        futures[executor.submit(run_chapter, chapter_index)] = chapter_index


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


def _cancel_pending_chapters(futures: dict[Future[NovelLoopResult], int]) -> None:
    for future in futures:
        future.cancel()


def _shutdown_pending_chapters(
    executor: ThreadPoolExecutor,
    futures: dict[Future[NovelLoopResult], int],
) -> None:
    _cancel_pending_chapters(futures)
    executor.shutdown(wait=False, cancel_futures=True)


def _run_consistency_barrier(
    consistency_barrier: ConsistencyBarrier | None,
    chapter_index: int,
    chapter_result: NovelLoopResult,
    committed_chapters: list[dict[str, Any]],
) -> ChapterConsistencyReport | None:
    if consistency_barrier is None:
        return None
    return consistency_barrier(chapter_index, chapter_result, list(committed_chapters))


def _run_precommit_chapter(
    precommit_chapter: PrecommitChapter | None,
    chapter_index: int,
    chapter_result: NovelLoopResult,
    committed_chapters: list[dict[str, Any]],
) -> NovelLoopResult:
    if precommit_chapter is None:
        return chapter_result
    return precommit_chapter(chapter_index, chapter_result, list(committed_chapters))


def _consistency_blocked_result(
    chapter_index: int,
    chapter_result: NovelLoopResult,
    completed: list[dict[str, Any]],
    checkpoint: list[dict[str, Any]],
    budget: dict[str, int | float],
    report: ChapterConsistencyReport,
) -> BookLoopResult:
    """跨章一致性冲突时阻断该章，沿用 awaiting_review 流程并附带冲突明细。"""

    blocked_chapter = _chapter_progress(chapter_index, chapter_result)
    blocked_chapter["consistency_conflicts"] = list(report.conflicts)
    return BookLoopResult(
        status="awaiting_review",
        current_chapter_index=chapter_index,
        progress={
            "completed_chapters": completed,
            "checkpoint": checkpoint,
            "blocked_chapter": blocked_chapter,
            "budget": dict(budget),
            "consistency_conflict": {
                "chapter_index": chapter_index,
                "conflicts": list(report.conflicts),
            },
        },
    )


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


def _chapter_window_size(request: BookLoopRequest) -> int:
    if request.require_prior_chapter_commit_before_start:
        return 1
    if request.require_budget_guard_before_prefetch and _preemptive_pause_enabled(request):
        return 1
    return request.chapter_parallelism


def _with_integration_metrics(result: BookLoopResult, metrics: dict[str, Any]) -> BookLoopResult:
    progress = dict(result.progress)
    progress["integration_metrics"] = metrics
    return BookLoopResult(status=result.status, current_chapter_index=result.current_chapter_index, progress=progress)


def _parallel_integration_metrics(
    request: BookLoopRequest,
    max_in_flight: int,
    runtime_tracker: _ParallelRuntimeTracker,
    precommit_revision_count: int = 0,
) -> dict[str, Any]:
    target_window = min(
        max(1, request.chapter_parallelism),
        max(1, request.total_chapters - request.start_chapter_index + 1),
    )
    runtime_metrics = runtime_tracker.metrics(target_window)
    metrics = {
        "concurrent_chapter_utilization": runtime_metrics["parallel_runtime_utilization"],
        "metric_scope": "workflow_book_loop_parallel_runtime_overlap",
        "chapter_parallelism": request.chapter_parallelism,
        "max_in_flight_chapters": max_in_flight,
        "target_parallel_window": target_window,
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
        "memory_atom_ids": list(result.memory_atom_ids),
        "continuity_edge_count": result.continuity_edge_count,
        "skill_runs": list(result.skill_runs),
    }


def _checkpoint_entry(chapter_progress: dict[str, Any]) -> dict[str, Any]:
    return {
        "chapter_index": chapter_progress["chapter_index"],
        "status": chapter_progress["status"],
        "model_run_id": chapter_progress["model_run_id"],
        "judge_report_id": chapter_progress["judge_report_id"],
        "approved_scene_id": chapter_progress["approved_scene_id"],
        "token_usage": chapter_progress["token_usage"],
        "elapsed_time_sec": chapter_progress["elapsed_time_sec"],
        "cost_estimate": chapter_progress["cost_estimate"],
        "memory_atom_ids": list(chapter_progress.get("memory_atom_ids") or []),
        "continuity_edge_count": chapter_progress.get("continuity_edge_count", 0),
        "skill_runs": list(chapter_progress["skill_runs"]),
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
    return value if isinstance(value, int) and value > 0 else 0


def _float_value(value: object) -> float:
    return float(value) if isinstance(value, int | float) and value > 0 else 0.0
