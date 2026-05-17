from __future__ import annotations

import re
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domains.books.models import Book
from app.domains.retrieval.models import RetrievalChunk, RetrievalRefreshRun, RetrievalSource
from app.domains.retrieval.schemas import (
    RetrievalHitRead,
    RetrievalRefreshRunCreate,
    RetrievalSearchCreate,
    RetrievalSourceCreate,
)
from app.domains.series.models import Series


class RetrievalInputError(ValueError):
    """检索域输入引用不存在或作用域不合法时抛出。"""


def create_retrieval_source(session: Session, payload: RetrievalSourceCreate) -> RetrievalSource:
    _require_scope(session, payload.book_id, payload.series_id)
    source = RetrievalSource(
        book_id=payload.book_id,
        series_id=payload.series_id,
        source_type=payload.source_type,
        title=payload.title,
        status="active",
        content_text=payload.content_text,
        payload=payload.payload,
    )
    session.add(source)
    session.flush()
    _sync_source_chunks(source)
    session.commit()
    return _load_source(session, source.id)


def list_retrieval_sources(session: Session, book_id: int | None = None, series_id: int | None = None) -> Sequence[RetrievalSource]:
    statement = select(RetrievalSource).options(selectinload(RetrievalSource.chunks)).order_by(RetrievalSource.id)
    if book_id is not None:
        statement = statement.where(RetrievalSource.book_id == book_id)
    if series_id is not None:
        statement = statement.where(RetrievalSource.series_id == series_id)
    return session.scalars(statement).all()


def create_retrieval_refresh_run(session: Session, payload: RetrievalRefreshRunCreate) -> RetrievalRefreshRun:
    sources = _select_refresh_sources(session, payload)
    if not sources:
        raise RetrievalInputError("没有找到可刷新的资料源。")
    for source in sources:
        _sync_source_chunks(source)
    refresh_run = RetrievalRefreshRun(
        source_id=payload.source_id,
        book_id=payload.book_id,
        series_id=payload.series_id,
        status="completed",
        chunk_count=sum(len(source.chunks) for source in sources),
        payload={"source_ids": [source.id for source in sources]},
    )
    session.add(refresh_run)
    session.commit()
    session.refresh(refresh_run)
    return refresh_run


def search_retrieval(session: Session, payload: RetrievalSearchCreate) -> list[RetrievalHitRead]:
    statement = (
        select(RetrievalChunk)
        .options(selectinload(RetrievalChunk.source))
        .join(RetrievalSource, RetrievalChunk.source_id == RetrievalSource.id)
        .where(RetrievalSource.status == "active")
        .order_by(RetrievalSource.id, RetrievalChunk.chunk_index, RetrievalChunk.id)
    )
    if payload.book_id is not None:
        statement = statement.where(RetrievalSource.book_id == payload.book_id)
    if payload.series_id is not None:
        statement = statement.where(RetrievalSource.series_id == payload.series_id)
    chunks = session.scalars(statement).all()
    query_terms = _keywords(payload.query)
    scored: list[tuple[float, RetrievalChunk]] = []
    for chunk in chunks:
        score = _score_chunk(chunk, query_terms, payload.query)
        if score > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda item: (-item[0], item[1].source_id, item[1].chunk_index, item[1].id))
    return [
        RetrievalHitRead(
            source_id=chunk.source_id,
            chunk_id=chunk.id,
            source_ref=f"retrieval:{chunk.source_id}:{chunk.id}",
            book_id=chunk.source.book_id,
            series_id=chunk.source.series_id,
            title=chunk.source.title,
            excerpt=chunk.content[:160],
            score=round(score, 4),
            rank=rank,
        )
        for rank, (score, chunk) in enumerate(scored[: payload.limit], start=1)
    ]


def _require_scope(session: Session, book_id: int | None, series_id: int | None) -> None:
    if book_id is not None and session.get(Book, book_id) is None:
        raise RetrievalInputError("作品不存在，无法创建检索资料源。")
    if series_id is not None and session.get(Series, series_id) is None:
        raise RetrievalInputError("系列不存在，无法创建检索资料源。")


def _select_refresh_sources(session: Session, payload: RetrievalRefreshRunCreate) -> list[RetrievalSource]:
    statement = select(RetrievalSource).options(selectinload(RetrievalSource.chunks)).order_by(RetrievalSource.id)
    if payload.source_id is not None:
        source = session.get(RetrievalSource, payload.source_id)
        return [] if source is None else [_load_source(session, source.id)]
    if payload.book_id is not None:
        if session.get(Book, payload.book_id) is None:
            raise RetrievalInputError("作品不存在，无法刷新检索资料源。")
        statement = statement.where(RetrievalSource.book_id == payload.book_id)
    if payload.series_id is not None:
        if session.get(Series, payload.series_id) is None:
            raise RetrievalInputError("系列不存在，无法刷新检索资料源。")
        statement = statement.where(RetrievalSource.series_id == payload.series_id)
    return list(session.scalars(statement).all())


def _load_source(session: Session, source_id: int) -> RetrievalSource:
    source = session.scalars(
        select(RetrievalSource).options(selectinload(RetrievalSource.chunks)).where(RetrievalSource.id == source_id)
    ).one()
    return source


def _sync_source_chunks(source: RetrievalSource) -> None:
    source.chunks.clear()
    for index, content in enumerate(_chunk_text(source.content_text), start=1):
        source.chunks.append(
            RetrievalChunk(
                chunk_index=index,
                content=content,
                token_count=max(1, (len(content) + 5) // 6),
                keywords=_keywords(content),
                embedding=_fake_embedding(content),
            )
        )


def _chunk_text(content_text: str, *, chunk_size: int = 120) -> list[str]:
    fragments = [fragment.strip() for fragment in re.split(r"[。！？\n]+", content_text) if fragment.strip()]
    if not fragments:
        return [content_text.strip()]
    chunks: list[str] = []
    current = ""
    for fragment in fragments:
        candidate = fragment if not current else f"{current}。{fragment}"
        if len(candidate) <= chunk_size:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = fragment
    if current:
        chunks.append(current)
    return chunks


def _keywords(value: str) -> list[str]:
    parts = [part.lower() for part in re.split(r"[^0-9A-Za-z\u4e00-\u9fff]+", value) if part.strip()]
    seen: list[str] = []
    for part in parts:
        for candidate in _expand_keyword_candidates(part):
            if candidate not in seen:
                seen.append(candidate)
    return seen


def _expand_keyword_candidates(part: str) -> list[str]:
    candidates = [part]
    if re.search(r"[\u4e00-\u9fff]", part):
        normalized = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "", part)
        if len(normalized) >= 2:
            for size in (2, 3):
                if len(normalized) < size:
                    continue
                candidates.extend(normalized[index : index + size] for index in range(len(normalized) - size + 1))
    return candidates


def _fake_embedding(content: str) -> list[float]:
    base = _keywords(content)[:4]
    return [float((sum(ord(char) for char in word) % 97) / 97) for word in base] or [0.0]


def _score_chunk(chunk: RetrievalChunk, query_terms: list[str], raw_query: str) -> float:
    chunk_text = chunk.content.lower()
    overlap = sum(1 for term in query_terms if term in chunk.keywords or term in chunk_text)
    if overlap == 0 and raw_query.lower() not in chunk_text and raw_query.lower() not in chunk.source.title.lower():
        return 0.0
    bonus = 0.5 if raw_query.lower() in chunk_text else 0.0
    title_bonus = 0.25 if any(term in chunk.source.title.lower() for term in query_terms) else 0.0
    return float(overlap) + bonus + title_bonus
