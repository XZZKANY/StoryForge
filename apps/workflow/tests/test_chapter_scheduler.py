from __future__ import annotations

from storyforge_workflow.orchestrators.chapter_scheduler import ChapterScheduleContext, chapter_window_size


def test_chapter_scheduler_uses_three_two_one_phases_for_thirty_chapters() -> None:
    """30 章长篇应按前 50% / 中段 / 收尾 20% 逐步收窄窗口。"""

    assert chapter_window_size(
        ChapterScheduleContext(total_chapters=30, next_chapter_index=1, requested_parallelism=5)
    ) == 3
    assert chapter_window_size(
        ChapterScheduleContext(total_chapters=30, next_chapter_index=15, requested_parallelism=5)
    ) == 3
    assert chapter_window_size(
        ChapterScheduleContext(total_chapters=30, next_chapter_index=16, requested_parallelism=5)
    ) == 2
    assert chapter_window_size(
        ChapterScheduleContext(total_chapters=30, next_chapter_index=24, requested_parallelism=5)
    ) == 2
    assert chapter_window_size(
        ChapterScheduleContext(total_chapters=30, next_chapter_index=25, requested_parallelism=5)
    ) == 1
    assert chapter_window_size(
        ChapterScheduleContext(total_chapters=30, next_chapter_index=30, requested_parallelism=5)
    ) == 1


def test_chapter_scheduler_respects_requested_parallelism_upper_bound() -> None:
    """调度窗口不能超过调用方显式请求的章节并发度。"""

    assert chapter_window_size(
        ChapterScheduleContext(total_chapters=30, next_chapter_index=1, requested_parallelism=2)
    ) == 2
    assert chapter_window_size(
        ChapterScheduleContext(total_chapters=30, next_chapter_index=16, requested_parallelism=1)
    ) == 1


def test_chapter_scheduler_forces_serial_for_dependency_and_budget_guard_modes() -> None:
    """依赖前章提交或预算保守门禁时必须串行。"""

    assert chapter_window_size(
        ChapterScheduleContext(
            total_chapters=30,
            next_chapter_index=1,
            requested_parallelism=5,
            require_prior_chapter_commit_before_start=True,
        )
    ) == 1
    assert chapter_window_size(
        ChapterScheduleContext(
            total_chapters=30,
            next_chapter_index=1,
            requested_parallelism=5,
            require_budget_guard_before_prefetch=True,
            has_preemptive_budget_or_pause_guard=True,
        )
    ) == 1


def test_chapter_scheduler_reports_phase_aware_decisions_for_metrics() -> None:
    """指标侧应能看到目标窗口与阶段，便于集成观测。"""

    decision = ChapterScheduleContext(
        total_chapters=30,
        next_chapter_index=16,
        requested_parallelism=5,
    ).decide()

    assert decision.phase == "middle"
    assert decision.phase_limit == 2
    assert decision.window_size == 2
