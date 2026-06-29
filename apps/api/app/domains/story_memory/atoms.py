from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter
from app.domains.retrieval.embedding_client import EmbeddingClient
from app.domains.story_memory.errors import StoryMemoryInputError
from app.domains.story_memory.models import MemoryAtomRecord
from app.domains.story_memory.schemas import MemoryAtom


def create_memory_atom(
    session: Session,
    payload: MemoryAtom,
    *,
    embedding_client: EmbeddingClient | None = None,
) -> MemoryAtom:
    """创建长效记忆事实，并返回契约对象。"""

    if session.get(Book, payload.novel_id) is None:
        raise StoryMemoryInputError("作品不存在，无法写入长效记忆。")
    if payload.source_chapter_id is not None:
        chapter = session.get(Chapter, payload.source_chapter_id)
        if chapter is None or chapter.book_id != payload.novel_id:
            raise StoryMemoryInputError("章节来源不存在或不属于当前作品，无法写入长效记忆。")
    record = MemoryAtomRecord(
        book_id=payload.novel_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        fact_type=payload.fact_type,
        value=payload.value,
        source_chapter_id=payload.source_chapter_id,
        valid_from_chapter=payload.valid_from_chapter,
        valid_to_chapter=payload.valid_to_chapter,
        immutable=payload.immutable,
        confidence=payload.confidence,
        revision=payload.revision,
        embedding=_memory_atom_embedding(payload, embedding_client),
        source_ref=payload.source_ref,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return _record_to_atom(record)


def list_memory_atoms(
    session: Session,
    *,
    book_id: int,
    entity_type: str | None = None,
    entity_id: str | None = None,
    fact_type: str | None = None,
) -> list[MemoryAtom]:
    """按作品和可选实体条件列出长效记忆事实。"""

    statement = select(MemoryAtomRecord).where(MemoryAtomRecord.book_id == book_id)
    if entity_type is not None:
        statement = statement.where(MemoryAtomRecord.entity_type == entity_type)
    if entity_id is not None:
        statement = statement.where(MemoryAtomRecord.entity_id == entity_id)
    if fact_type is not None:
        statement = statement.where(MemoryAtomRecord.fact_type == fact_type)
    records = session.scalars(_memory_atom_default_order(statement)).all()
    return [_record_to_atom(record) for record in records]


def get_active_memory_atoms(
    session: Session,
    *,
    book_id: int,
    chapter_ordinal: int,
    entity_type: str | None = None,
    entity_id: str | None = None,
    fact_type: str | None = None,
) -> list[MemoryAtom]:
    """从数据库读取指定章节序号有效的长效记忆事实。

    Phase 2 修复：参数改名为 chapter_ordinal，明确语义为章节序号（1,2,3...）。
    """

    return [
        atom
        for atom in list_memory_atoms(
            session,
            book_id=book_id,
            entity_type=entity_type,
            entity_id=entity_id,
            fact_type=fact_type,
        )
        if _is_active(atom, chapter_ordinal)
    ]


def atoms_active_at_chapter(atoms: list[MemoryAtom], chapter_ordinal: int) -> list[MemoryAtom]:
    """按章节序号读取有效事实，避免后期设定覆盖前期状态。

    Phase 2 修复：参数改名为 chapter_ordinal，明确语义。
    """

    return [atom for atom in atoms if _is_active(atom, chapter_ordinal)]


def _memory_atom_default_order(statement):
    return statement.order_by(
        MemoryAtomRecord.entity_type,
        MemoryAtomRecord.entity_id,
        MemoryAtomRecord.fact_type,
        MemoryAtomRecord.id,
    )


def _memory_atom_embedding(atom: MemoryAtom, embedding_client: EmbeddingClient | None) -> list[float]:
    if embedding_client is None:
        return []
    result = embedding_client.embed_texts([_memory_atom_embedding_text(atom)])
    if not result.vectors:
        return []
    return result.vectors[0]


def _memory_atom_embedding_text(atom: MemoryAtom) -> str:
    return f"{atom.entity_type} {atom.entity_id} {atom.fact_type} {atom.value}"


def _is_active(atom: MemoryAtom, chapter_ordinal: int) -> bool:
    """判断 memory atom 在指定章节序号是否有效。

    Phase 2 修复：统一使用 ordinal（章节序号 1,2,3...）而非 PK（数据库 ID）。
    """
    if chapter_ordinal < atom.valid_from_chapter:
        return False
    return atom.valid_to_chapter is None or chapter_ordinal <= atom.valid_to_chapter


def _record_to_atom(record: MemoryAtomRecord) -> MemoryAtom:
    return MemoryAtom(
        memory_id=f"memory:{record.id}",
        novel_id=record.book_id,
        entity_type=record.entity_type,  # type: ignore[arg-type]
        entity_id=record.entity_id,
        fact_type=record.fact_type,  # type: ignore[arg-type]
        value=record.value,
        source_ref=record.source_ref,
        source_chapter_id=record.source_chapter_id,
        valid_from_chapter=record.valid_from_chapter,
        valid_to_chapter=record.valid_to_chapter,
        confidence=record.confidence,
        immutable=record.immutable,
        revision=record.revision,
        embedding=list(record.embedding or []),
    )
