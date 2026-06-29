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
CommitChapterSideEffects = Callable[[int, NovelLoopResult, list[dict[str, Any]]], NovelLoopResult]
