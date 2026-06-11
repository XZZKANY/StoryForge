from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ChapterSchedulePhase = Literal["early", "middle", "final"]


@dataclass(frozen=True)
class ChapterScheduleDecision:
    phase: ChapterSchedulePhase
    phase_limit: int
    window_size: int


@dataclass(frozen=True)
class ChapterScheduleContext:
    total_chapters: int
    next_chapter_index: int
    requested_parallelism: int
    require_prior_chapter_commit_before_start: bool = False
    require_budget_guard_before_prefetch: bool = False
    has_preemptive_budget_or_pause_guard: bool = False

    def decide(self) -> ChapterScheduleDecision:
        phase, phase_limit = _phase_for_chapter(self.total_chapters, self.next_chapter_index)
        if self.require_prior_chapter_commit_before_start:
            return ChapterScheduleDecision(phase=phase, phase_limit=phase_limit, window_size=1)
        if self.require_budget_guard_before_prefetch and self.has_preemptive_budget_or_pause_guard:
            return ChapterScheduleDecision(phase=phase, phase_limit=phase_limit, window_size=1)
        return ChapterScheduleDecision(
            phase=phase,
            phase_limit=phase_limit,
            window_size=max(1, min(self.requested_parallelism, phase_limit)),
        )


def chapter_window_size(context: ChapterScheduleContext) -> int:
    return context.decide().window_size


def _phase_for_chapter(total_chapters: int, chapter_index: int) -> tuple[ChapterSchedulePhase, int]:
    total = max(1, total_chapters)
    index = max(1, min(chapter_index, total))
    if index <= total * 0.5:
        return "early", 3
    if index <= total * 0.8:
        return "middle", 2
    return "final", 1
