"""BookRun 域 Timeline 事件同步。

从 completed_chapters progress 派生 TimelineEventRecord，为写作任务进度提供可查询的编年史。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.book_runs._coerce import (
    nested_progress_int as _nested_progress_int,
)
from app.domains.book_runs._coerce import (
    positive_int as _positive_int,
)
from app.domains.book_runs._coerce import (
    string_list as _string_list,
)
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Chapter
from app.domains.timeline.models import TimelineEventRecord
from app.domains.timeline.schemas import TimelineEventCreate

# ↓ service.py 定义的常量，从 facade 导入以保持单向依赖
DEFAULT_TIMELINE_PROJECT_ID = 1
DEFAULT_TIMELINE_VOLUME_ID = 1


def _sync_completed_chapter_timeline_events(session: Session, book_run: BookRun, progress: dict) -> None:
    completed_chapters = progress.get("completed_chapters")
    if not isinstance(completed_chapters, list):
        return
    completed_items = [item for item in completed_chapters if isinstance(item, dict)]
    if not completed_items:
        return
    chapters_by_progress = _chapters_by_completed_progress(session, book_run, completed_items)
    chapter_ids = [chapter.id for chapter in chapters_by_progress.values()]
    existing_events = _existing_timeline_events_by_chapter(session, book_run.id, book_run.book_id, chapter_ids)
    for completed_chapter in completed_items:
        chapter = chapters_by_progress.get(_completed_progress_key(completed_chapter))
        if chapter is None:
            continue
        if _timeline_event_matches_completed_chapter(
            existing_events.get(chapter.id, []),
            book_run.id,
            chapter.id,
            completed_chapter,
        ):
            continue
        payload = _timeline_event_payload_for_completed_chapter(book_run, progress, completed_chapter, chapter)
        session.add(TimelineEventRecord(**payload.model_dump()))


def _chapters_by_completed_progress(
    session: Session,
    book_run: BookRun,
    completed_chapters: list[dict],
) -> dict[tuple[str, int], Chapter]:
    chapter_ids = {
        chapter_id
        for completed_chapter in completed_chapters
        if (chapter_id := _positive_int(completed_chapter.get("chapter_id"))) is not None
    }
    chapter_indexes = {
        chapter_index
        for completed_chapter in completed_chapters
        if _positive_int(completed_chapter.get("chapter_id")) is None
        and (chapter_index := _positive_int(completed_chapter.get("chapter_index"))) is not None
    }
    chapters: list[Chapter] = []
    if chapter_ids:
        chapters.extend(
            session.scalars(
                select(Chapter).where(
                    Chapter.book_id == book_run.book_id,
                    Chapter.id.in_(chapter_ids),
                )
            ).all()
        )
    if chapter_indexes:
        chapters.extend(
            session.scalars(
                select(Chapter).where(
                    Chapter.book_id == book_run.book_id,
                    Chapter.ordinal.in_(chapter_indexes),
                )
            ).all()
        )
    by_id = {chapter.id: chapter for chapter in chapters}
    by_index = {chapter.ordinal: chapter for chapter in chapters}
    resolved: dict[tuple[str, int], Chapter] = {}
    for completed_chapter in completed_chapters:
        key = _completed_progress_key(completed_chapter)
        chapter = by_id.get(key[1]) if key[0] == "chapter_id" else by_index.get(key[1])
        if chapter is not None:
            resolved[key] = chapter
    return resolved


def _completed_progress_key(completed_chapter: dict) -> tuple[str, int]:
    chapter_id = _positive_int(completed_chapter.get("chapter_id"))
    if chapter_id is not None:
        return ("chapter_id", chapter_id)
    chapter_index = _positive_int(completed_chapter.get("chapter_index"))
    return ("chapter_index", chapter_index or 0)


def _existing_timeline_events_by_chapter(
    session: Session,
    book_run_id: int,
    book_id: int,
    chapter_ids: list[int],
) -> dict[int, list[TimelineEventRecord]]:
    if not chapter_ids:
        return {}
    source_ref = f"book_run:{book_run_id}"
    rows = session.scalars(
        select(TimelineEventRecord).where(
            TimelineEventRecord.book_id == book_id,
            TimelineEventRecord.chapter_id.in_(chapter_ids),
        )
    ).all()
    grouped: dict[int, list[TimelineEventRecord]] = {}
    for event in rows:
        evidence_refs = event.evidence_refs if isinstance(event.evidence_refs, list) else []
        payload = event.payload if isinstance(event.payload, dict) else {}
        if source_ref not in evidence_refs and payload.get("source") != source_ref:
            continue
        grouped.setdefault(event.chapter_id, []).append(event)
    return grouped


def _timeline_event_matches_completed_chapter(
    candidates: list[TimelineEventRecord],
    book_run_id: int,
    chapter_id: int,
    completed_chapter: dict,
) -> bool:
    for event in candidates:
        if _timeline_event_is_completed_chapter_match(event, book_run_id, chapter_id, completed_chapter):
            return True
    return False


def _timeline_event_is_completed_chapter_match(
    event: TimelineEventRecord,
    book_run_id: int,
    chapter_id: int,
    completed_chapter: dict,
) -> bool:
    source_ref = f"book_run:{book_run_id}"
    chapter_ref = f"chapter:{chapter_id}"
    chapter_index = completed_chapter.get("chapter_index")
    evidence_refs = event.evidence_refs if isinstance(event.evidence_refs, list) else []
    payload = event.payload if isinstance(event.payload, dict) else {}
    completed_payload = payload.get("completed_chapter")
    if source_ref in evidence_refs and chapter_ref in evidence_refs:
        return True
    if payload.get("source") != source_ref or not isinstance(completed_payload, dict):
        return False
    return completed_payload.get("chapter_index") == chapter_index


def _timeline_event_payload_for_completed_chapter(
    book_run: BookRun,
    progress: dict,
    completed_chapter: dict,
    chapter: Chapter,
) -> TimelineEventCreate:
    defaulted_fields: dict[str, str] = {}
    project_id = _timeline_project_id(progress, completed_chapter, defaulted_fields)
    volume_id = _timeline_volume_id(progress, completed_chapter, defaulted_fields)
    chapter_index = _positive_int(completed_chapter.get("chapter_index")) or chapter.ordinal
    payload = {
        "source": f"book_run:{book_run.id}",
        "book_run_id": book_run.id,
        "completed_chapter": _timeline_completed_chapter_payload(completed_chapter, chapter),
    }
    if defaulted_fields:
        payload["defaulted_fields"] = defaulted_fields
    return TimelineEventCreate(
        project_id=project_id,
        book_id=book_run.book_id,
        volume_id=volume_id,
        chapter_id=chapter.id,
        time_order=chapter_index,
        summary=_timeline_summary_for_completed_chapter(completed_chapter, chapter),
        evidence_refs=_timeline_evidence_refs(book_run.id, chapter.id, completed_chapter),
        payload=payload,
    )


def _timeline_completed_chapter_payload(completed_chapter: dict, chapter: Chapter) -> dict[str, object]:
    payload = {
        key: value
        for key, value in completed_chapter.items()
        if key
        in {
            "chapter_index",
            "chapter_id",
            "model_run_id",
            "judge_report_id",
            "approved_scene_id",
            "summary",
            "chapter_summary",
            "final_summary",
            "volume_id",
            "project_id",
        }
    }
    payload["chapter_id"] = chapter.id
    payload.setdefault("chapter_index", chapter.ordinal)
    return payload


def _timeline_project_id(progress: dict, completed_chapter: dict, defaulted_fields: dict[str, str]) -> int:
    project_id = _positive_int(completed_chapter.get("project_id")) or _positive_int(progress.get("project_id"))
    if project_id is not None:
        return project_id
    defaulted_fields["project_id"] = "BookRun progress 未提供 project_id，当前作品模型没有项目字段，使用受控默认 1。"
    return DEFAULT_TIMELINE_PROJECT_ID


def _timeline_volume_id(progress: dict, completed_chapter: dict, defaulted_fields: dict[str, str]) -> int:
    volume_id = (
        _positive_int(completed_chapter.get("volume_id"))
        or _positive_int(progress.get("volume_id"))
        or _positive_int(progress.get("current_volume"))
        or _positive_int(_nested_progress_int(progress, "volume", "current_volume"))
        or _positive_int(_nested_progress_int(progress, "volume_checkpoint", "current_volume"))
    )
    if volume_id is not None:
        return volume_id
    defaulted_fields["volume_id"] = "BookRun progress 未提供 volume_id，当前章节模型没有卷字段，使用受控默认 1。"
    return DEFAULT_TIMELINE_VOLUME_ID


def _timeline_summary_for_completed_chapter(completed_chapter: dict, chapter: Chapter) -> str:
    for key in ("summary", "chapter_summary", "final_summary"):
        value = completed_chapter.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return (chapter.summary or chapter.title or f"第 {chapter.ordinal} 章已完成").strip()


def _timeline_evidence_refs(book_run_id: int, chapter_id: int, completed_chapter: dict) -> list[str]:
    refs = [f"book_run:{book_run_id}", f"chapter:{chapter_id}"]
    for key, prefix in (
        ("model_run_id", "model_run"),
        ("judge_report_id", "judge_report"),
        ("approved_scene_id", "approved_scene"),
    ):
        value = _positive_int(completed_chapter.get(key))
        if value is not None:
            refs.append(f"{prefix}:{value}")
    refs.extend(f"memory:{memory_id}" for memory_id in _string_list(completed_chapter.get("memory_atom_ids")))
    return refs


sync_completed_chapter_timeline_events = _sync_completed_chapter_timeline_events
