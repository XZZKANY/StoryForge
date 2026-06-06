"""跨章弧线一致性屏障。

Phase 3 长程一致性核心：把 Blueprint 规划的故事弧线（planning_refs.arc_ids）
与逐章真实产出对齐。每条弧线在其目标章节区间内必须被推进，到达 payoff 章节时
若仍未推进（仍处 planted），屏障判定为冲突并阻断后续章节，避免"埋了线却从不收"
的长程崩塌。

屏障只消费 dispatch 已下发的轻量引用与逐章结果，不查询 API 数据库，
也不把完整规划对象塞进 checkpoint。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from storyforge_workflow.orchestrators.book_loop import ChapterConsistencyReport
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult

# 弧线状态机：未推进 → 已推进 → 已强化。到 payoff 仍为 planted 即冲突。
ARC_STATE_PLANTED = "planted"
ARC_STATE_PROGRESSED = "progressed"
ARC_STATE_REINFORCED = "reinforced"


class _ArcTracker:
    """单条弧线的逐章推进状态。"""

    def __init__(self, arc_id: str, expected_chapters: list[int]) -> None:
        self.arc_id = arc_id
        self.expected_chapters = sorted(set(expected_chapters))
        self.payoff_chapter = self.expected_chapters[-1]
        self.progression_count = 0

    @property
    def state(self) -> str:
        if self.progression_count == 0:
            return ARC_STATE_PLANTED
        if self.progression_count == 1:
            return ARC_STATE_PROGRESSED
        return ARC_STATE_REINFORCED

    def note_progress(self) -> None:
        self.progression_count += 1


class ArcConsistencyBarrier:
    """基于 dispatch planning_refs 的弧线到期检查屏障。

    构造时从每章 planning_refs 提取 arc_id → 目标章节映射；运行时每章完成后，
    把"该章被批准且属于某弧线目标区间"视为该弧线的一次推进，并在弧线 payoff
    章节做到期检查。
    """

    def __init__(self, chapters: Mapping[int, Mapping[str, Any]]) -> None:
        arc_chapters: dict[str, list[int]] = {}
        for chapter_index, chapter in chapters.items():
            if not isinstance(chapter, Mapping):
                continue
            planning_refs = chapter.get("planning_refs")
            if not isinstance(planning_refs, Mapping):
                continue
            for arc_id in planning_refs.get("arc_ids", []):
                if isinstance(arc_id, str) and arc_id.strip():
                    arc_chapters.setdefault(arc_id.strip(), []).append(chapter_index)
        self._trackers: dict[str, _ArcTracker] = {
            arc_id: _ArcTracker(arc_id, expected) for arc_id, expected in arc_chapters.items()
        }

    def arc_state(self, arc_id: str) -> str | None:
        tracker = self._trackers.get(arc_id)
        return tracker.state if tracker is not None else None

    def __call__(
        self,
        chapter_index: int,
        chapter_result: NovelLoopResult,
        committed_chapters: list[dict[str, Any]],
    ) -> ChapterConsistencyReport | None:
        approved = chapter_result.status == "approved"
        for tracker in self._trackers.values():
            if approved and chapter_index in tracker.expected_chapters:
                tracker.note_progress()
        conflicts = [
            {
                "kind": "arc_stalled",
                "arc_id": tracker.arc_id,
                "payoff_chapter": tracker.payoff_chapter,
                "current_chapter": chapter_index,
                "state": tracker.state,
            }
            for tracker in self._trackers.values()
            if chapter_index >= tracker.payoff_chapter and tracker.state == ARC_STATE_PLANTED
        ]
        if conflicts:
            return ChapterConsistencyReport(conflicts=conflicts)
        return None
