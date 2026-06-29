from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter
from app.domains.story_memory.atoms import create_memory_atom
from app.domains.story_memory.errors import StoryMemoryInputError
from app.domains.story_memory.schemas import MemoryAtom


def write_memory_extract_atoms(
    session: Session,
    *,
    book_id: int,
    chapter_id: int,
    approved_scene_id: int,
    extraction: Mapping[str, object],
) -> list[MemoryAtom]:
    """把 memory_extract 的白名单抽取结果写入 Story Memory。"""

    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.book_id != book_id:
        raise StoryMemoryInputError("章节来源不存在或不属于当前作品，无法写入长效记忆。")
    if session.get(Book, book_id) is None:
        raise StoryMemoryInputError("作品不存在，无法写入长效记忆。")
    if approved_scene_id <= 0:
        raise StoryMemoryInputError("批准场景引用无效，无法写入长效记忆。")

    atoms: list[MemoryAtom] = []
    for payload in _memory_extract_atom_payloads(
        book_id=book_id,
        chapter=chapter,
        approved_scene_id=approved_scene_id,
        extraction=extraction,
    ):
        atoms.append(create_memory_atom(session, payload))
    return atoms


def _memory_extract_atom_payloads(
    *,
    book_id: int,
    chapter: Chapter,
    approved_scene_id: int,
    extraction: Mapping[str, object],
) -> list[MemoryAtom]:
    atoms: list[MemoryAtom] = []
    _append_chapter_summary_atom(atoms, book_id, chapter, approved_scene_id, extraction.get("chapter_summary"))
    _append_collection_atoms(
        atoms,
        book_id=book_id,
        chapter=chapter,
        approved_scene_id=approved_scene_id,
        kind="character_state",
        raw_items=extraction.get("character_states"),
        entity_type="character",
        fact_type="status",
        entity_keys=("entity_id", "character_id", "name", "character"),
        value_keys=("status", "state", "value", "summary"),
    )
    _append_collection_atoms(
        atoms,
        book_id=book_id,
        chapter=chapter,
        approved_scene_id=approved_scene_id,
        kind="world_fact",
        raw_items=extraction.get("world_facts"),
        entity_type="world_rule",
        fact_type="rule",
        entity_keys=("entity_id", "rule_id", "name", "title"),
        value_keys=("rule", "fact", "value", "summary"),
    )
    _append_collection_atoms(
        atoms,
        book_id=book_id,
        chapter=chapter,
        approved_scene_id=approved_scene_id,
        kind="foreshadow_ref",
        raw_items=extraction.get("foreshadow_refs"),
        entity_type="subplot",
        fact_type="plot_thread",
        entity_keys=("entity_id", "thread_id", "name", "title"),
        value_keys=("value", "summary", "ref", "status"),
    )
    return atoms


def _append_chapter_summary_atom(
    atoms: list[MemoryAtom],
    book_id: int,
    chapter: Chapter,
    approved_scene_id: int,
    raw_summary: object,
) -> None:
    item: Mapping[str, object] = raw_summary if isinstance(raw_summary, Mapping) else {"summary": raw_summary}
    value = _first_text(item, ("summary", "value", "text"))
    if value is None:
        return
    entity_id = _first_text(item, ("entity_id",)) or f"chapter:{chapter.ordinal}"
    atoms.append(
        _memory_extract_atom(
            book_id=book_id,
            chapter=chapter,
            approved_scene_id=approved_scene_id,
            kind="chapter_summary",
            index=1,
            entity_type="subplot",
            entity_id=entity_id,
            fact_type="plot_thread",
            value=value,
            confidence=_confidence(item),
            immutable=_bool_value(item.get("immutable")),
        )
    )


def _append_collection_atoms(
    atoms: list[MemoryAtom],
    *,
    book_id: int,
    chapter: Chapter,
    approved_scene_id: int,
    kind: str,
    raw_items: object,
    entity_type: str,
    fact_type: str,
    entity_keys: tuple[str, ...],
    value_keys: tuple[str, ...],
) -> None:
    for index, item in enumerate(_mapping_items(raw_items), start=1):
        entity_id = _first_text(item, entity_keys)
        value = _first_text(item, value_keys)
        if entity_id is None or value is None:
            continue
        atoms.append(
            _memory_extract_atom(
                book_id=book_id,
                chapter=chapter,
                approved_scene_id=approved_scene_id,
                kind=kind,
                index=index,
                entity_type=entity_type,
                entity_id=entity_id,
                fact_type=fact_type,
                value=value,
                confidence=_confidence(item),
                immutable=_bool_value(item.get("immutable")),
                valid_to_chapter=_optional_positive_int(item.get("valid_to_chapter")),
            )
        )


def _memory_extract_atom(
    *,
    book_id: int,
    chapter: Chapter,
    approved_scene_id: int,
    kind: str,
    index: int,
    entity_type: str,
    entity_id: str,
    fact_type: str,
    value: str,
    confidence: float,
    immutable: bool,
    valid_to_chapter: int | None = None,
) -> MemoryAtom:
    return MemoryAtom(
        memory_id=f"memory_extract:{chapter.id}:{kind}:{index}",
        novel_id=book_id,
        entity_type=entity_type,  # type: ignore[arg-type]
        entity_id=entity_id,
        fact_type=fact_type,  # type: ignore[arg-type]
        value=value,
        source_ref=f"chapter:{chapter.id}#approved_scene:{approved_scene_id}#memory_extract:{kind}:{index}",
        source_chapter_id=chapter.id,
        valid_from_chapter=chapter.ordinal,
        valid_to_chapter=valid_to_chapter,
        confidence=confidence,
        immutable=immutable,
    )


def _mapping_items(value: object) -> list[Mapping[str, object]]:
    if isinstance(value, Mapping):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, Mapping)]
    return []


def _first_text(item: Mapping[str, object], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                return normalized
    return None


def _confidence(item: Mapping[str, object]) -> float:
    value = item.get("confidence")
    if isinstance(value, int | float):
        return min(1.0, max(0.0, float(value)))
    return 1.0


def _bool_value(value: object) -> bool:
    return value if isinstance(value, bool) else False


def _optional_positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and value > 0 else None
