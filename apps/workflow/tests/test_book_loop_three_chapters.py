from __future__ import annotations

from threading import Event, Lock
from time import perf_counter

from storyforge_workflow.orchestrators.book_loop import (
    BookLoopRequest,
    ChapterConsistencyReport,
    run_book_loop,
)
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


def _approved_chapter(chapter_index: int) -> NovelLoopResult:
    return NovelLoopResult(
        status="approved",
        final_draft=f"第 {chapter_index} 章正文。",
        source_model_run_id=chapter_index,
        judge_report_id=chapter_index,
        repair_patch_id=None,
        approved_scene_id=chapter_index,
    )


def test_book_loop_runs_three_chapters_to_completed() -> None:
    """BookLoop 应按章节顺序驱动三章 NovelLoop 并完成。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index * 10,
            judge_report_id=chapter_index * 10 + 1,
            repair_patch_id=None,
            approved_scene_id=chapter_index * 10 + 2,
        )

    result = run_book_loop(BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3), run_chapter)

    assert result.status == "completed"
    assert result.current_chapter_index == 3
    assert seen == [1, 2, 3]
    assert [item["chapter_index"] for item in result.progress["completed_chapters"]] == [1, 2, 3]


def test_book_loop_stops_when_chapter_awaits_review() -> None:
    """任一章节需要人工审查时，BookLoop 不应继续后续章节。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="awaiting_review" if chapter_index == 2 else "approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index if chapter_index == 1 else None,
        )

    result = run_book_loop(BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3), run_chapter)

    assert result.status == "awaiting_review"
    assert result.current_chapter_index == 2
    assert seen == [1, 2]
    assert result.progress["blocked_chapter"]["chapter_index"] == 2


def test_book_loop_resume_skips_completed_checkpoint_chapters() -> None:
    """恢复运行时应从 checkpoint 下一章继续，不重复执行已批准章节。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index * 10,
            judge_report_id=chapter_index * 10 + 1,
            repair_patch_id=None,
            approved_scene_id=chapter_index * 10 + 2,
            token_usage=120,
            cost_estimate=0.02,
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=3,
            start_chapter_index=3,
            existing_checkpoint=[
                {"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12},
                {"chapter_index": 2, "model_run_id": 20, "judge_report_id": 21, "approved_scene_id": 22},
            ],
        ),
        run_chapter,
    )

    assert seen == [3]
    assert result.status == "completed"
    assert [item["chapter_index"] for item in result.progress["completed_chapters"]] == [1, 2, 3]
    assert len(result.progress["checkpoint"]) == 3


def test_book_loop_pauses_when_token_budget_is_reached() -> None:
    """Token 预算触顶后 BookLoop 必须硬暂停，不能继续下一章。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
            token_usage=80,
            cost_estimate=0.03,
        )

    result = run_book_loop(
        BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3, token_budget=100),
        run_chapter,
    )

    assert seen == [1, 2]
    assert result.status == "paused_by_budget"
    assert result.current_chapter_index == 2
    assert result.progress["budget"]["tokens_used"] == 160
    assert result.progress["pause_reason"] == "token_budget_exceeded"


def test_book_loop_pauses_after_consecutive_fallbacks() -> None:
    """连续 fallback 达到阈值时应暂停，避免整本书静默跑在备用模型上。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
            fallback_metadata={"primary_provider_error": "主 provider 超时"},
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=3,
            provider_fallback_pause_threshold=2,
        ),
        run_chapter,
    )

    assert seen == [1, 2]
    assert result.status == "paused_by_provider_degradation"
    assert result.current_chapter_index == 2
    assert result.progress["provider_degradation"]["consecutive_fallbacks"] == 2


def test_book_loop_can_prefetch_chapters_but_commit_progress_in_order() -> None:
    """显式开启章节并发时，可并发启动章节，但 checkpoint 与 progress 必须按章节顺序提交。"""

    first_chapter_can_finish = Event()
    started: list[int] = []
    completed: list[int] = []
    progress_indexes: list[int] = []
    lock = Lock()

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        with lock:
            started.append(chapter_index)
            if len(started) == 3:
                first_chapter_can_finish.set()
        if chapter_index == 1:
            first_chapter_can_finish.wait(timeout=2)
        with lock:
            completed.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=3,
            chapter_parallelism=3,
        ),
        run_chapter,
        progress_callback=lambda progress: progress_indexes.append(progress.current_chapter_index),
    )

    assert result.status == "completed"
    assert set(started) == {1, 2, 3}
    assert completed[0] != 1
    assert progress_indexes == [1, 2, 3]
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1, 2, 3]
    assert result.progress["integration_metrics"]["max_in_flight_chapters"] == 3
    assert result.progress["integration_metrics"]["metric_scope"] == "workflow_book_loop_parallel_runtime_overlap"


def test_book_loop_parallel_utilization_uses_runtime_overlap_not_submitted_window() -> None:
    """并发利用率必须来自实际执行重叠时间，不能只看提交过几个 future。"""

    started: list[int] = []
    lock = Lock()

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        with lock:
            started.append(chapter_index)
        # 任务几乎立即完成：旧口径因一次性提交 3 个 future 会报 1.0，
        # 新口径应按 worker 实际运行重叠面积给出很低的利用率。
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=3,
            chapter_parallelism=3,
        ),
        run_chapter,
    )

    metrics = result.progress["integration_metrics"]
    assert result.status == "completed"
    assert set(started) == {1, 2, 3}
    assert metrics["max_in_flight_chapters"] == 3
    assert metrics["concurrent_chapter_utilization"] < 1.0
    assert metrics["metric_scope"] == "workflow_book_loop_parallel_runtime_overlap"


def test_book_loop_parallel_can_wait_for_prior_commit_before_starting_next_chapter() -> None:
    """启用前序提交依赖时，第 N 章启动前必须已经提交第 N-1 章。"""

    committed_indexes: list[int] = []
    start_observations: dict[int, int] = {}
    lock = Lock()

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        with lock:
            start_observations[chapter_index] = len(committed_indexes)
        if chapter_index == 1:
            # 当前旧实现会在第一章提交前预启动后续章节，红灯应能稳定暴露。
            first_chapter_can_commit.wait(timeout=0.2)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
        )

    first_chapter_can_commit = Event()

    def record_progress(progress) -> None:
        with lock:
            committed_indexes.append(progress.current_chapter_index)
        if progress.current_chapter_index == 1:
            first_chapter_can_commit.set()

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=3,
            chapter_parallelism=3,
            require_prior_chapter_commit_before_start=True,
        ),
        run_chapter,
        progress_callback=record_progress,
    )

    assert result.status == "completed"
    assert start_observations == {1: 0, 2: 1, 3: 2}
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1, 2, 3]


def test_book_loop_parallel_can_prefetch_then_revise_before_commit() -> None:
    """P1.5 两段式模式应允许并发起草，并在按序提交前用已提交前文校正。"""

    all_chapters_started = Event()
    committed_indexes: list[int] = []
    start_observations: dict[int, int] = {}
    revision_observations: dict[int, int] = {}
    lock = Lock()

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        with lock:
            start_observations[chapter_index] = len(committed_indexes)
            if len(start_observations) == 3:
                all_chapters_started.set()
        if chapter_index == 1:
            all_chapters_started.wait(timeout=2)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章初稿。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
            token_usage=chapter_index,
        )

    def revise_before_commit(
        chapter_index: int,
        chapter_result: NovelLoopResult,
        committed_chapters: list[dict[str, object]],
    ) -> NovelLoopResult:
        with lock:
            revision_observations[chapter_index] = len(committed_chapters)
        return NovelLoopResult(
            status=chapter_result.status,
            final_draft=f"第 {chapter_index} 章校正稿。",
            source_model_run_id=1000 + chapter_index,
            judge_report_id=2000 + chapter_index,
            repair_patch_id=chapter_result.repair_patch_id,
            approved_scene_id=3000 + chapter_index,
            token_usage=chapter_result.token_usage + 10,
        )

    def record_progress(progress) -> None:
        with lock:
            committed_indexes.append(progress.current_chapter_index)

    result = run_book_loop(
        BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3, chapter_parallelism=3),
        run_chapter,
        progress_callback=record_progress,
        precommit_chapter=revise_before_commit,
    )

    assert result.status == "completed"
    assert start_observations == {1: 0, 2: 0, 3: 0}
    assert revision_observations == {1: 0, 2: 1, 3: 2}
    assert [item["model_run_id"] for item in result.progress["checkpoint"]] == [1001, 1002, 1003]
    assert result.progress["budget"]["tokens_used"] == 36


def test_book_loop_parallel_token_budget_starts_window_then_pauses_without_refill() -> None:
    """存在 token 预算时仍应并发启动窗口，预算触顶后停止补充新章节。"""

    first_chapter_can_finish = Event()
    started: list[int] = []
    lock = Lock()

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        with lock:
            started.append(chapter_index)
            if len(started) == 3:
                first_chapter_can_finish.set()
        if chapter_index == 1:
            first_chapter_can_finish.wait(timeout=2)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
            token_usage=80,
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=5,
            token_budget=100,
            chapter_parallelism=3,
        ),
        run_chapter,
    )

    assert result.status == "paused_by_budget"
    assert result.current_chapter_index == 2
    assert set(started) == {1, 2, 3}
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1, 2]
    assert result.progress["budget"]["tokens_used"] == 160
    assert result.progress["pause_reason"] == "token_budget_exceeded"


def test_book_loop_parallel_budget_guard_can_disable_prefetch_window() -> None:
    """启用预算保守模式时，token 预算触顶前不得预启动窗口外章节。"""

    started: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        started.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
            token_usage=80,
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=5,
            token_budget=100,
            chapter_parallelism=3,
            require_budget_guard_before_prefetch=True,
        ),
        run_chapter,
    )

    assert result.status == "paused_by_budget"
    assert result.current_chapter_index == 2
    assert started == [1, 2]
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1, 2]
    assert result.progress["integration_metrics"]["prefetch_mode"] == "budget_guarded"


def test_book_loop_parallel_provider_degradation_starts_window_then_pauses() -> None:
    """存在 provider 降级门禁时仍应并发启动窗口，并在连续 fallback 达阈值后暂停。"""

    first_chapter_can_finish = Event()
    started: list[int] = []
    lock = Lock()

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        with lock:
            started.append(chapter_index)
            if len(started) == 3:
                first_chapter_can_finish.set()
        if chapter_index == 1:
            first_chapter_can_finish.wait(timeout=2)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
            fallback_metadata={"primary_provider_error": "主 provider 超时"},
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=5,
            provider_fallback_pause_threshold=2,
            chapter_parallelism=3,
        ),
        run_chapter,
    )

    assert result.status == "paused_by_provider_degradation"
    assert result.current_chapter_index == 2
    assert set(started) == {1, 2, 3}
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1, 2]
    assert result.progress["provider_degradation"]["consecutive_fallbacks"] == 2


def test_book_loop_parallel_awaiting_review_accumulates_blocked_chapter_budget() -> None:
    """并发路径遇到 awaiting_review 时，budget 应包含被阻断章节已经消耗的用量。"""

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        return NovelLoopResult(
            status="awaiting_review" if chapter_index == 2 else "approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index if chapter_index == 1 else None,
            token_usage=chapter_index * 10,
            elapsed_time_sec=chapter_index,
            cost_estimate=chapter_index * 0.01,
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=3,
            chapter_parallelism=3,
        ),
        run_chapter,
    )

    assert result.status == "awaiting_review"
    assert result.current_chapter_index == 2
    assert result.progress["budget"] == {
        "tokens_used": 30,
        "elapsed_time_sec": 3,
        "estimated_cost": 0.03,
    }


def test_book_loop_parallel_failure_returns_without_waiting_for_started_later_chapter() -> None:
    """并发章节失败时应快速返回，不等待已启动但无法取消的后续章节自然结束。"""

    third_chapter_started = Event()
    release_third_chapter = Event()

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        if chapter_index == 2:
            assert third_chapter_started.wait(timeout=1)
            raise RuntimeError("第二章失败")
        if chapter_index == 3:
            third_chapter_started.set()
            release_third_chapter.wait(timeout=0.4)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
        )

    started_at = perf_counter()
    try:
        try:
            run_book_loop(
                BookLoopRequest(
                    book_run_id=1,
                    book_id=2,
                    blueprint_id=3,
                    total_chapters=3,
                    chapter_parallelism=3,
                ),
                run_chapter,
            )
        except Exception as exc:
            assert str(exc) == "第二章失败"
    finally:
        elapsed = perf_counter() - started_at
        release_third_chapter.set()

    assert elapsed < 0.2


def test_book_loop_parallel_consistency_barrier_passes_through_when_no_conflict() -> None:
    """屏障无冲突时，并发章节应全部按序提交并完成。"""

    barrier_calls: list[tuple[int, int]] = []

    def consistency_barrier(chapter_index, chapter_result, committed_chapters):
        # 提交第 N 章时，应能看到第 1..N-1 章已按序提交的快照。
        barrier_calls.append((chapter_index, len(committed_chapters)))
        return ChapterConsistencyReport(conflicts=[])

    result = run_book_loop(
        BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3, chapter_parallelism=3),
        lambda chapter_index: _approved_chapter(chapter_index),
        consistency_barrier=consistency_barrier,
    )

    assert result.status == "completed"
    assert barrier_calls == [(1, 0), (2, 1), (3, 2)]
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1, 2, 3]


def test_book_loop_parallel_consistency_barrier_blocks_on_conflict() -> None:
    """屏障在第 2 章检出跨章冲突时，应阻断该章并附带冲突明细，不提交后续章节。"""

    def consistency_barrier(chapter_index, chapter_result, committed_chapters):
        if chapter_index == 2:
            return ChapterConsistencyReport(
                conflicts=[{"kind": "timeline_conflict", "detail": "第 2 章让已故角色复活"}]
            )
        return ChapterConsistencyReport(conflicts=[])

    result = run_book_loop(
        BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3, chapter_parallelism=3),
        lambda chapter_index: _approved_chapter(chapter_index),
        consistency_barrier=consistency_barrier,
    )

    assert result.status == "awaiting_review"
    assert result.current_chapter_index == 2
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1]
    blocked = result.progress["blocked_chapter"]
    assert blocked["chapter_index"] == 2
    assert blocked["consistency_conflicts"][0]["kind"] == "timeline_conflict"
    assert result.progress["consistency_conflict"]["chapter_index"] == 2


def test_book_loop_sequential_consistency_barrier_blocks_on_conflict() -> None:
    """串行路径同样应受屏障约束，在冲突章节停止并保留前序已批准章节。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return _approved_chapter(chapter_index)

    def consistency_barrier(chapter_index, chapter_result, committed_chapters):
        if chapter_index == 2:
            return ChapterConsistencyReport(conflicts=[{"kind": "relationship_conflict"}])
        return None

    result = run_book_loop(
        BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3),
        run_chapter,
        consistency_barrier=consistency_barrier,
    )

    assert seen == [1, 2]
    assert result.status == "awaiting_review"
    assert result.current_chapter_index == 2
    assert [item["chapter_index"] for item in result.progress["checkpoint"]] == [1]
    assert result.progress["consistency_conflict"]["conflicts"][0]["kind"] == "relationship_conflict"
