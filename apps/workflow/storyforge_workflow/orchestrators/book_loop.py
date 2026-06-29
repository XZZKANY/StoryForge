from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Any

from storyforge_workflow.orchestrators.book_loop_budget import (
    _accumulate_budget,
    _budget_pause_reason,
    _fallback_limit_reached,
    _initial_budget,
    _paused_by_budget,
    _provider_degradation_result,
)
from storyforge_workflow.orchestrators.book_loop_results import (
    _chapter_progress,
    _checkpoint_entry,
    _consistency_blocked_result,
    _generated_but_uncommitted_after,
)
from storyforge_workflow.orchestrators.book_loop_scheduling import (
    _fill_chapter_window,
    _parallel_integration_metrics,
    _parallelism_enabled,
    _ParallelRuntimeTracker,
    _preemptive_pause_enabled,
    _with_integration_metrics,
)
from storyforge_workflow.orchestrators.book_loop_types import (
    BookLoopRequest,
    BookLoopResult,
    ChapterConsistencyReport,
    ChapterExecutionError,
    CommitChapterSideEffects,
    ConsistencyBarrier,
    PrecommitChapter,
)
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


def run_book_loop(
    request: BookLoopRequest,
    run_chapter: Callable[[int], NovelLoopResult],
    progress_callback: Callable[[BookLoopResult], None] | None = None,
    consistency_barrier: ConsistencyBarrier | None = None,
    precommit_chapter: PrecommitChapter | None = None,
    commit_chapter_side_effects: CommitChapterSideEffects | None = None,
) -> BookLoopResult:
    """顺序驱动每章 NovelLoop，按 checkpoint、预算和 provider 降级约束暂停。"""

    if _parallelism_enabled(request):
        return _run_book_loop_parallel(
            request,
            run_chapter,
            progress_callback,
            consistency_barrier,
            precommit_chapter,
            commit_chapter_side_effects,
        )

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
        consistency_report = _run_consistency_barrier(consistency_barrier, chapter_index, chapter_result, completed)
        if consistency_report is not None and consistency_report.has_conflict:
            _accumulate_budget(budget, chapter_result)
            return _consistency_blocked_result(chapter_index, chapter_result, completed, checkpoint, budget, consistency_report)
        if chapter_result.status != "approved":
            _accumulate_budget(budget, chapter_result)
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
        chapter_result = _run_commit_chapter_side_effects(
            commit_chapter_side_effects, chapter_index, chapter_result, completed
        )
        _accumulate_budget(budget, chapter_result)
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
    commit_chapter_side_effects: CommitChapterSideEffects | None = None,
) -> BookLoopResult:
    """并发预取章节结果，但只按章节顺序提交 checkpoint 和 progress。"""

    completed = list(request.existing_checkpoint)
    checkpoint = list(request.existing_checkpoint)
    budget = _initial_budget(completed)
    pending_results: dict[int, NovelLoopResult] = {}
    futures: dict[Future[NovelLoopResult], int] = {}
    next_schedule_index = request.start_chapter_index
    next_commit_index = request.start_chapter_index
    consecutive_fallbacks = 0
    max_in_flight = 0
    precommit_revision_count = 0
    schedule_decisions: list[dict[str, Any]] = []
    runtime_tracker = _ParallelRuntimeTracker()
    tracked_run_chapter = runtime_tracker.wrap(run_chapter)

    executor = ThreadPoolExecutor(
        max_workers=max(1, request.chapter_parallelism),
        thread_name_prefix="storyforge-book-chapter",
    )
    executor_closed = False
    try:
        next_schedule_index = _fill_chapter_window(
            executor, tracked_run_chapter, request, next_schedule_index, futures, schedule_decisions
        )
        max_in_flight = max(max_in_flight, len(futures))
        while futures or pending_results:
            while next_commit_index in pending_results:
                chapter_result = pending_results.pop(next_commit_index)
                if precommit_chapter is not None:
                    chapter_result = _run_precommit_chapter(
                        precommit_chapter, next_commit_index, chapter_result, completed
                    )
                    precommit_revision_count += 1
                consistency_report = _run_consistency_barrier(
                    consistency_barrier, next_commit_index, chapter_result, completed
                )
                if consistency_report is not None and consistency_report.has_conflict:
                    _accumulate_budget(budget, chapter_result)
                    _shutdown_pending_chapters(executor, futures)
                    executor_closed = True
                    return _with_integration_metrics(
                        _consistency_blocked_result(
                            next_commit_index,
                            chapter_result,
                            completed,
                            checkpoint,
                            budget,
                            consistency_report,
                            generated_but_uncommitted=_generated_but_uncommitted_after(
                                next_commit_index, pending_results
                            ),
                        ),
                        _parallel_integration_metrics(
                            request, max_in_flight, runtime_tracker, precommit_revision_count, schedule_decisions
                        ),
                    )
                if chapter_result.status != "approved":
                    _accumulate_budget(budget, chapter_result)
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
                        _parallel_integration_metrics(
                            request, max_in_flight, runtime_tracker, precommit_revision_count, schedule_decisions
                        ),
                    )
                chapter_result = _run_commit_chapter_side_effects(
                    commit_chapter_side_effects, next_commit_index, chapter_result, completed
                )
                _accumulate_budget(budget, chapter_result)
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
                            _parallel_integration_metrics(
                                request, max_in_flight, runtime_tracker, precommit_revision_count, schedule_decisions
                            ),
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
                        _parallel_integration_metrics(
                            request, max_in_flight, runtime_tracker, precommit_revision_count, schedule_decisions
                        ),
                    )
                pause_reason = _budget_pause_reason(request, budget)
                if pause_reason is not None:
                    _shutdown_pending_chapters(executor, futures)
                    executor_closed = True
                    return _with_integration_metrics(
                        _paused_by_budget(next_commit_index, completed, checkpoint, budget, pause_reason),
                        _parallel_integration_metrics(
                            request, max_in_flight, runtime_tracker, precommit_revision_count, schedule_decisions
                        ),
                    )
                next_commit_index += 1
            if not futures:
                next_schedule_index = _fill_chapter_window(
                    executor, tracked_run_chapter, request, next_schedule_index, futures, schedule_decisions
                )
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
                next_schedule_index = _fill_chapter_window(
                    executor, tracked_run_chapter, request, next_schedule_index, futures, schedule_decisions
                )
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
        _parallel_integration_metrics(request, max_in_flight, runtime_tracker, precommit_revision_count, schedule_decisions),
    )


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


def _run_commit_chapter_side_effects(
    commit_chapter_side_effects: CommitChapterSideEffects | None,
    chapter_index: int,
    chapter_result: NovelLoopResult,
    committed_chapters: list[dict[str, Any]],
) -> NovelLoopResult:
    if commit_chapter_side_effects is None:
        return chapter_result
    return commit_chapter_side_effects(chapter_index, chapter_result, list(committed_chapters))
