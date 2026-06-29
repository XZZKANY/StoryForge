from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from storyforge_workflow.orchestrators.book_loop_types import ConsistencyBarrier
from storyforge_workflow.orchestrators.novel_loop import NovelLoopPorts, NovelLoopRequest

MemoryExtractor = Callable[[NovelLoopRequest, str, int], list[str]]
ContinuitySubmitter = Callable[[NovelLoopRequest, str, int], dict[str, Any]]


@dataclass(frozen=True)
class BookRunChapterRange:
    """卷计划中的章节范围。"""

    start: int
    end: int


@dataclass(frozen=True)
class BookRunVolumePlanItem:
    """workflow 消费的卷计划项。"""

    volume_index: int
    chapter_range: BookRunChapterRange


@dataclass(frozen=True)
class BookRunAdapterRequest:
    """workflow adapter 接收的 BookRun 执行输入，不包含 API ORM 对象。"""

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
    require_budget_guard_before_prefetch: bool = False
    volume_plan: list[BookRunVolumePlanItem | dict[str, Any]] = field(default_factory=list)
    narrative_plan: dict[str, Any] | None = None
    chapter_beats: list[dict[str, Any]] = field(default_factory=list)
    entity_budget: dict[str, Any] | None = None
    phase_policy: dict[str, Any] | None = None
    beat_sheet_gate: dict[str, Any] | None = None
    narrative_risk_summary: dict[str, Any] | None = None


class BookRunProgressSink(Protocol):
    """BookRun progress 回填边界，可由测试、本地 service adapter 或 HTTP adapter 实现。"""

    def emit(
        self,
        *,
        book_run_id: int,
        status: str,
        current_chapter_index: int,
        progress: dict[str, Any],
        volume_progress: dict[str, Any] | None = None,
    ) -> None: ...


@dataclass(frozen=True)
class BookRunAdapterPorts:
    """adapter 外部依赖端口，避免 workflow 直接依赖 API 数据库。"""

    chapter_goal: Callable[[int], str]
    chapter_id: Callable[[int], int]
    novel_loop_ports_factory: Callable[[NovelLoopRequest], NovelLoopPorts]
    progress_sink: BookRunProgressSink
    memory_extractor: MemoryExtractor | None = None
    continuity_submitter: ContinuitySubmitter | None = None
    consistency_barrier: ConsistencyBarrier | None = None
    chapter_planning_refs: Callable[[int], dict[str, Any] | None] | None = None


class CapturingProgressSink:
    """测试用 progress sink，记录 adapter 回填 payload。"""

    def __init__(self) -> None:
        self.payloads: list[dict[str, Any]] = []

    def emit(
        self,
        *,
        book_run_id: int,
        status: str,
        current_chapter_index: int,
        progress: dict[str, Any],
        volume_progress: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            "book_run_id": book_run_id,
            "status": status,
            "current_chapter_index": current_chapter_index,
            "progress": progress,
        }
        if volume_progress is not None:
            payload["volume_progress"] = volume_progress
        self.payloads.append(payload)


class CallableProgressSink:
    """把标准 progress payload 转交给 HTTP、队列或本地 service adapter。"""

    def __init__(self, send: Callable[[dict[str, Any]], None]) -> None:
        self._send = send

    def emit(
        self,
        *,
        book_run_id: int,
        status: str,
        current_chapter_index: int,
        progress: dict[str, Any],
        volume_progress: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            "book_run_id": book_run_id,
            "status": status,
            "current_chapter_index": current_chapter_index,
            "progress": progress,
        }
        if volume_progress is not None:
            payload["volume_progress"] = volume_progress
        self._send(payload)
