"""BookRun 域 Longform Context 预检。

分卷或长篇 dispatch 前验证跨章上下文真相源是否就绪。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunChapterRange, BookRunVolumePlanItem
from app.domains.character_bible.service import list_character_bible_entries
from app.domains.story_memory.service import list_memory_atoms
from app.domains.timeline.service import list_timeline_events


def _require_longform_context_ready(
    session: Session,
    *,
    book_run: BookRun,
    blueprint: BookBlueprint,
    volume_plan: list[BookRunVolumePlanItem],
) -> None:
    """长篇或分卷 dispatch 前必须能证明跨章上下文真相源已就绪。"""

    if not _requires_longform_context(blueprint, volume_plan):
        return
    missing = _longform_context_missing_items(session, book_run=book_run)
    if missing:
        from app.domains.book_runs.service import BookRunBlockedError

        raise BookRunBlockedError(f"长篇上下文门禁未满足：{', '.join(missing)}。")


def _requires_longform_context(blueprint: BookBlueprint, volume_plan: list[BookRunVolumePlanItem]) -> bool:
    metadata = blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {}
    if metadata.get("longform_context_required") is True:
        return True
    if len(volume_plan) > 1:
        return True
    scale = metadata.get("story_scale") or metadata.get("workflow_type") or metadata.get("mode")
    return isinstance(scale, str) and scale.lower() in {"longform", "long", "novel", "volume", "serialized"}


def _longform_context_missing_items(session: Session, *, book_run: BookRun) -> list[str]:
    missing: list[str] = []
    if not _has_story_memory_context(session, book_run=book_run):
        missing.append("Story Memory")
    if not _has_character_bible_context(session, book_run=book_run):
        missing.append("Character Bible")
    if not _has_timeline_context(session, book_run=book_run):
        missing.append("Timeline")
    if not _has_foreshadow_context(session, book_run=book_run):
        missing.append("Foreshadow")
    return missing


def _has_story_memory_context(session: Session, *, book_run: BookRun) -> bool:
    atoms = list_memory_atoms(session, book_id=book_run.book_id)
    return any(
        atom.fact_type in {"status", "location", "rule", "knowledge", "plot_thread"}
        and not atom.source_ref.startswith("character_bible:")
        and "foreshadow_lifecycle" not in atom.value
        for atom in atoms
    )


def _has_character_bible_context(session: Session, *, book_run: BookRun) -> bool:
    return any(entry.sync_status == "synced" and entry.memory_atom_id for entry in list_character_bible_entries(session, book_id=book_run.book_id))


def _has_timeline_context(session: Session, *, book_run: BookRun) -> bool:
    return bool(list_timeline_events(session, book_id=book_run.book_id))


def _has_foreshadow_context(session: Session, *, book_run: BookRun) -> bool:
    lifecycle_atoms = list_memory_atoms(
        session,
        book_id=book_run.book_id,
        entity_type="subplot",
        fact_type="plot_thread",
    )
    states = ('"state": "planted"', '"state": "reinforced"', '"state": "paid_off"', '"state": "abandoned"')
    return any("foreshadow_lifecycle" in atom.value and any(state in atom.value for state in states) for atom in lifecycle_atoms)


def _explicit_volume_plan(value: object, total_chapters: int) -> list[BookRunVolumePlanItem]:
    if not isinstance(value, list):
        return []
    items: list[BookRunVolumePlanItem] = []
    for raw in value:
        if not isinstance(raw, dict):
            return []
        chapter_range = raw.get("chapter_range")
        if not isinstance(chapter_range, dict):
            return []
        volume_index = raw.get("volume_index")
        start = chapter_range.get("start")
        end = chapter_range.get("end")
        if not all(isinstance(item, int) and item > 0 for item in (volume_index, start, end)):
            return []
        if start > end or start > total_chapters:
            return []
        items.append(
            BookRunVolumePlanItem(
                volume_index=volume_index,
                chapter_range=BookRunChapterRange(start=start, end=min(end, total_chapters)),
            )
        )
    return items or _single_volume_plan(total_chapters)


def _even_volume_plan(volume_count: int, total_chapters: int) -> list[BookRunVolumePlanItem]:
    base = total_chapters // volume_count
    remainder = total_chapters % volume_count
    start = 1
    items: list[BookRunVolumePlanItem] = []
    for index in range(1, volume_count + 1):
        size = base + (1 if index <= remainder else 0)
        end = start + size - 1
        items.append(
            BookRunVolumePlanItem(
                volume_index=index,
                chapter_range=BookRunChapterRange(start=start, end=end),
            )
        )
        start = end + 1
    return items


def _single_volume_plan(total_chapters: int) -> list[BookRunVolumePlanItem]:
    return [
        BookRunVolumePlanItem(
            volume_index=1,
            chapter_range=BookRunChapterRange(start=1, end=total_chapters),
        )
    ]
