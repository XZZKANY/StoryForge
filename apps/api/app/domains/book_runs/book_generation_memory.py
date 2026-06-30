from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Chapter
from app.domains.retrieval.embedding_client import resolve_embedding_client
from app.domains.story_memory.service import recall_scene_memory_atoms, write_memory_extract_atoms


def memory_recall_chars_for_chapter(session: Session, book_id: int, chapter_ordinal: int) -> int:
    """统计当前章节 prompt 实际相关召回的记忆字符数。"""

    if chapter_ordinal <= 1:
        return 0
    chapter = session.execute(
        select(Chapter).where(Chapter.book_id == book_id, Chapter.ordinal == chapter_ordinal)
    ).scalar_one_or_none()
    if chapter is None:
        return 0
    atoms = recall_scene_memory_atoms(
        session,
        book_id=book_id,
        chapter=chapter,
        assets=[],
        continuity_records=[],
        embedding_client=resolve_embedding_client(),
    )
    return sum(len(f"{atom.entity_id}：{atom.value}") for atom in atoms)


def extract_memory_atoms_for_chapter(
    session: Session,
    *,
    book_id: int,
    chapter_id: int,
    chapter_ordinal: int,
    approved_scene_id: int,
    content: str,
) -> list[str]:
    """从已批准章节生成稳定的本地抽取结果并写入 Story Memory。"""

    extraction = {
        "chapter_summary": {
            "entity_id": f"chapter:{chapter_ordinal}",
            "summary": _chapter_memory_summary(content),
            "confidence": 0.8,
        },
        "character_states": character_state_extracts(content, pov=_chapter_pov(session, chapter_id)),
        "world_facts": world_fact_extracts(content, location=_chapter_location(session, chapter_id)),
    }
    atoms = write_memory_extract_atoms(
        session,
        book_id=book_id,
        chapter_id=chapter_id,
        approved_scene_id=approved_scene_id,
        extraction=extraction,
    )
    return [atom.memory_id for atom in atoms]


def character_state_extracts(content: str, *, pov: str | None) -> list[dict[str, object]]:
    extracts: list[dict[str, object]] = []
    entity_id = pov.strip() if isinstance(pov, str) and pov.strip() else ""
    if entity_id and entity_id in content:
        extracts.append({
            "entity_id": entity_id,
            "status": _sentence_containing(content, entity_id) or "本章持续参与主线行动。",
            "confidence": 0.78,
        })
    return extracts


def world_fact_extracts(content: str, *, location: str | None) -> list[dict[str, object]]:
    extracts: list[dict[str, object]] = []
    location_name = location.strip() if isinstance(location, str) and location.strip() else ""
    if location_name and location_name in content:
        extracts.append({
            "entity_id": location_name,
            "rule": _sentence_containing(content, location_name) or f"{location_name}是本章关键地点。",
            "confidence": 0.72,
        })
    for term in _world_fact_terms(content):
        if any(item["entity_id"] == term for item in extracts):
            continue
        extracts.append({
            "entity_id": term,
            "rule": _sentence_containing(content, term) or f"{term}在本章成为有效设定。",
            "confidence": 0.68,
        })
    return extracts


def _chapter_memory_summary(content: str) -> str:
    normalized = " ".join(content.split())
    return normalized[:60] if normalized else "本章已批准正文。"


def _chapter_pov(session: Session, chapter_id: int) -> str | None:
    chapter = session.get(Chapter, chapter_id)
    return chapter.pov if chapter is not None else None


def _chapter_location(session: Session, chapter_id: int) -> str | None:
    chapter = session.get(Chapter, chapter_id)
    return chapter.location if chapter is not None else None


def _sentence_containing(content: str, term: str, *, max_chars: int = 50) -> str | None:
    for sentence in re.split(r"(?<=[。！？!?])", content):
        normalized = " ".join(sentence.split()).strip()
        if term in normalized:
            return normalized[:max_chars]
    return None


def _world_fact_terms(content: str) -> list[str]:
    pattern = re.compile(r"[\u4e00-\u9fff]{2,12}(?:规约|协议|许可|盟约|钟楼|密钥|线索|信号)")
    seen: set[str] = set()
    terms: list[str] = []
    for match in pattern.finditer(content):
        term = match.group(0)
        if term in seen:
            continue
        seen.add(term)
        terms.append(term)
        if len(terms) >= 3:
            break
    return terms
