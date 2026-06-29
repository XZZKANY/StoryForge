from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.ide.schemas import (
    IdeStoryMemoryConflict,
    IdeStoryMemoryItem,
    IdeStoryMemoryQuery,
    IdeStoryMemoryQueryResult,
)
from app.domains.story_memory.schemas import MemoryAtom, MemoryConflict
from app.domains.story_memory.service import detect_memory_conflicts, list_memory_atoms


def query_story_memory(session: Session, payload: IdeStoryMemoryQuery) -> IdeStoryMemoryQueryResult:
    """按 IDE 过滤条件查询长效记忆和冲突队列。"""

    atoms = list_memory_atoms(
        session,
        book_id=payload.book_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        fact_type=payload.fact_type,
    )
    if payload.chapter is not None:
        atoms = [atom for atom in atoms if _memory_active_at(atom, payload.chapter)]

    conflicts = detect_memory_conflicts(atoms)
    conflict_ids_by_memory = _conflict_ids_by_memory(conflicts)
    if payload.conflict_status == "conflicted":
        atoms = [atom for atom in atoms if atom.memory_id in conflict_ids_by_memory]
    elif payload.conflict_status == "clean":
        atoms = [atom for atom in atoms if atom.memory_id not in conflict_ids_by_memory]

    items = [_story_memory_item(atom, conflict_ids_by_memory.get(atom.memory_id, [])) for atom in atoms]
    return IdeStoryMemoryQueryResult(
        filters=payload,
        items=items,
        conflict_queue=[_story_memory_conflict(conflict) for conflict in conflicts],
        total=len(items),
        conflicted_count=sum(1 for item in items if item.conflict_ids),
    )


def _memory_active_at(atom: MemoryAtom, chapter: int) -> bool:
    if chapter < atom.valid_from_chapter:
        return False
    return atom.valid_to_chapter is None or chapter <= atom.valid_to_chapter


def _conflict_ids_by_memory(conflicts: list[MemoryConflict]) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for conflict in conflicts:
        mapping.setdefault(conflict.left_memory_id, []).append(conflict.conflict_id)
        mapping.setdefault(conflict.right_memory_id, []).append(conflict.conflict_id)
    return mapping


def _story_memory_item(atom: MemoryAtom, conflict_ids: list[str]) -> IdeStoryMemoryItem:
    return IdeStoryMemoryItem(
        memory_id=atom.memory_id,
        entity_type=atom.entity_type,
        entity_id=atom.entity_id,
        fact_type=atom.fact_type,
        value=atom.value,
        source_ref=atom.source_ref,
        source_chapter_id=atom.source_chapter_id,
        valid_from_chapter=atom.valid_from_chapter,
        valid_to_chapter=atom.valid_to_chapter,
        confidence=atom.confidence,
        immutable=atom.immutable,
        revision=atom.revision,
        conflict_ids=conflict_ids,
    )


def _story_memory_conflict(conflict: MemoryConflict) -> IdeStoryMemoryConflict:
    return IdeStoryMemoryConflict(
        conflict_id=conflict.conflict_id,
        entity_id=conflict.entity_id,
        fact_type=conflict.fact_type,
        left_memory_id=conflict.left_memory_id,
        right_memory_id=conflict.right_memory_id,
        severity=conflict.severity,
        reason=conflict.reason,
        source_refs=conflict.source_refs,
    )
