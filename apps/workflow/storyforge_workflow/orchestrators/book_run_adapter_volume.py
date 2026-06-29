from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from storyforge_workflow.orchestrators.book_loop import BookLoopResult
from storyforge_workflow.orchestrators.book_run_adapter_coerce import _optional_positive_int
from storyforge_workflow.orchestrators.book_run_adapter_types import (
    BookRunAdapterRequest,
    BookRunChapterRange,
    BookRunVolumePlanItem,
)


def _volume_progress_from_result(request: BookRunAdapterRequest, result: BookLoopResult) -> dict[str, Any]:
    """生成 API 受控的卷级进度摘要，避免把卷字段塞入普通 progress。"""

    completed = result.progress.get("completed_chapters")
    completed_chapters = completed if isinstance(completed, list) else []
    last_completed = _latest_completed_chapter_index(completed_chapters)
    next_start = min(request.total_chapters + 1, max(result.current_chapter_index, last_completed + 1))
    volume = _volume_for_chapter(_normalized_volume_plan(request), min(next_start, request.total_chapters))
    return {
        "current_volume": volume.volume_index,
        "chapter_range": {"start": volume.chapter_range.start, "end": volume.chapter_range.end},
        "completed_chapter_count": len(completed_chapters),
        "next_batch_start_chapter_index": next_start,
    }


def _normalized_volume_plan(request: BookRunAdapterRequest) -> list[BookRunVolumePlanItem]:
    return _volume_plan_or_single(request.volume_plan, request.total_chapters)


def _volume_plan_or_single(value: object, total_chapters: int) -> list[BookRunVolumePlanItem]:
    if not isinstance(value, list):
        return [_single_volume_plan_item(total_chapters)]
    items: list[BookRunVolumePlanItem] = []
    for raw in value:
        item = _volume_plan_item(raw, total_chapters)
        if item is None:
            return [_single_volume_plan_item(total_chapters)]
        items.append(item)
    return items or [_single_volume_plan_item(total_chapters)]


def _volume_plan_item(value: object, total_chapters: int) -> BookRunVolumePlanItem | None:
    if isinstance(value, BookRunVolumePlanItem):
        return value
    if not isinstance(value, Mapping):
        return None
    chapter_range = value.get("chapter_range")
    if not isinstance(chapter_range, Mapping):
        return None
    volume_index = _optional_positive_int(value.get("volume_index"))
    start = _optional_positive_int(chapter_range.get("start"))
    end = _optional_positive_int(chapter_range.get("end"))
    if volume_index is None or start is None or end is None or start > end or start > total_chapters:
        return None
    return BookRunVolumePlanItem(
        volume_index=volume_index,
        chapter_range=BookRunChapterRange(start=start, end=min(end, total_chapters)),
    )


def _single_volume_plan_item(total_chapters: int) -> BookRunVolumePlanItem:
    return BookRunVolumePlanItem(
        volume_index=1,
        chapter_range=BookRunChapterRange(start=1, end=total_chapters),
    )


def _volume_for_chapter(volume_plan: list[BookRunVolumePlanItem], chapter_index: int) -> BookRunVolumePlanItem:
    for item in volume_plan:
        if item.chapter_range.start <= chapter_index <= item.chapter_range.end:
            return item
    return volume_plan[-1]


def _latest_completed_chapter_index(completed_chapters: list[object]) -> int:
    indexes = [
        item.get("chapter_index")
        for item in completed_chapters
        if isinstance(item, Mapping) and isinstance(item.get("chapter_index"), int)
    ]
    return max(indexes, default=0)
