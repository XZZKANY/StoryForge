"""Phase 3 ArcConsistencyBarrier TDD 测试。

验证弧线状态机（planted → progressed → reinforced）、到期阻断逻辑，
以及无规划数据时保持现有放行行为。
"""

from __future__ import annotations

from storyforge_workflow.orchestrators.book_loop import ChapterConsistencyReport
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult
from storyforge_workflow.quality.arc_consistency import (
    ARC_STATE_PLANTED,
    ARC_STATE_PROGRESSED,
    ARC_STATE_REINFORCED,
    ArcConsistencyBarrier,
)


def _approved_result() -> NovelLoopResult:
    return NovelLoopResult(
        status="approved",
        final_draft="林岚确认灯塔信号失真。",
        source_model_run_id=501,
        judge_report_id=601,
        repair_patch_id=None,
        approved_scene_id=701,
    )


def _discarded_result() -> NovelLoopResult:
    return NovelLoopResult(
        status="rejected",
        final_draft="草稿未通过评审。",
        source_model_run_id=502,
        judge_report_id=602,
        repair_patch_id=None,
        approved_scene_id=None,
    )


def test_barrier_no_conflict_when_arc_not_at_payoff_yet() -> None:
    """弧线的 payoff 在第 3 章，第 1 章完成后不应触发阻断。"""

    barrier = ArcConsistencyBarrier(
        {
            1: {"planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.5}},
            2: {"planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.5}},
            3: {"planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.5}},
        }
    )

    assert barrier.arc_state("旧港信号") == ARC_STATE_PLANTED
    report = barrier(1, _approved_result(), [])
    assert report is None
    assert barrier.arc_state("旧港信号") == ARC_STATE_PROGRESSED


def test_barrier_blocks_when_arc_stalls_at_payoff() -> None:
    """弧线只在第 2 章有推进机会，该章被废弃 → 到达 payoff 仍 planted，应阻断。"""

    barrier = ArcConsistencyBarrier(
        {
            1: {"planning_refs": {"arc_ids": ["开篇钩子"], "arc_completion_ratio": 1.0}},
            2: {"planning_refs": {"arc_ids": ["灯塔许可"], "arc_completion_ratio": 1.0}},
        }
    )

    assert barrier.arc_state("灯塔许可") == ARC_STATE_PLANTED
    # 第 1 章只推进"开篇钩子"，与"灯塔许可"无关。
    report1 = barrier(1, _approved_result(), [])
    assert report1 is None
    assert barrier.arc_state("灯塔许可") == ARC_STATE_PLANTED

    # 第 2 章是"灯塔许可"唯一推进机会，但被废弃 → payoff 到期仍 planted → 阻断。
    report = barrier(2, _discarded_result(), [{"chapter_index": 1, "status": "approved"}])
    assert report is not None
    assert report.has_conflict
    assert len(report.conflicts) == 1
    assert report.conflicts[0]["kind"] == "arc_stalled"
    assert report.conflicts[0]["arc_id"] == "灯塔许可"
    assert report.conflicts[0]["payoff_chapter"] == 2
    assert report.conflicts[0]["state"] == ARC_STATE_PLANTED


def test_barrier_reinforces_arc_across_multiple_chapters() -> None:
    """弧线被多章推进后，到达 payoff 前状态应为 reinforced。"""

    barrier = ArcConsistencyBarrier(
        {
            1: {"planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.67}},
            2: {"planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.67}},
            3: {"planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.67}},
        }
    )

    barrier(1, _approved_result(), [])
    assert barrier.arc_state("旧港信号") == ARC_STATE_PROGRESSED

    barrier(2, _approved_result(), [{"chapter_index": 1, "status": "approved"}])
    assert barrier.arc_state("旧港信号") == ARC_STATE_REINFORCED

    # payoff 第 3 章 → 已 reinforced，不阻断。
    report = barrier(3, _approved_result(), [
        {"chapter_index": 1, "status": "approved"},
        {"chapter_index": 2, "status": "approved"},
    ])
    assert report is None


def test_barrier_no_arcs_always_passes() -> None:
    """dispatch 无 planning_refs 时屏障不应产出冲突。"""

    barrier = ArcConsistencyBarrier({1: {"chapter_goal": "无弧线章节。", "chapter_id": 101}})
    assert barrier(1, _approved_result(), []) is None
    assert barrier(2, _approved_result(), [{"chapter_index": 1, "status": "approved"}]) is None


def test_barrier_empty_chapters_does_not_crash() -> None:
    """空 dispatch 构造 barrier 不应抛异常，所有检查放行。"""

    barrier = ArcConsistencyBarrier({})
    assert barrier(1, _approved_result(), []) is None
    assert barrier(2, _discarded_result(), []) is None
