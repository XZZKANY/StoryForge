from __future__ import annotations

import re
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.common.exceptions import InputError
from app.common.redaction import redact_sensitive
from app.common.scope import ScopeNotFoundError, validate_scope
from app.domains.retrieval.embedding_client import EmbeddingClient, EmbeddingResult, LocalEmbeddingClient
from app.domains.retrieval.models import RetrievalChunk, RetrievalRefreshRun, RetrievalSource
from app.domains.retrieval.schemas import RetrievalRefreshRunCreate, RetrievalSourceCreate
from app.domains.retrieval.scoring import _keywords
from app.domains.series.models import Series


class RetrievalInputError(InputError):
    """检索域输入引用不存在或作用域不合法时抛出。"""


def create_retrieval_source(
    session: Session,
    payload: RetrievalSourceCreate,
    embedding_client: EmbeddingClient | None = None,
) -> RetrievalSource:
    _require_scope(session, payload.book_id, payload.series_id)
    source = RetrievalSource(
        book_id=payload.book_id,
        series_id=payload.series_id,
        source_type=payload.source_type,
        title=payload.title,
        status="active",
        content_text=payload.content_text,
        payload=redact_sensitive(payload.payload),
    )
    session.add(source)
    session.flush()
    _sync_source_chunks(source, _resolve_embedding_client(embedding_client))
    session.commit()
    return _load_source(session, source.id)


def list_retrieval_sources(session: Session, book_id: int | None = None, series_id: int | None = None) -> Sequence[RetrievalSource]:
    statement = select(RetrievalSource).options(selectinload(RetrievalSource.chunks)).order_by(RetrievalSource.id)
    if book_id is not None:
        statement = statement.where(RetrievalSource.book_id == book_id)
    if series_id is not None:
        statement = statement.where(RetrievalSource.series_id == series_id)
    return session.scalars(statement).all()


def create_retrieval_refresh_run(
    session: Session,
    payload: RetrievalRefreshRunCreate,
    embedding_client: EmbeddingClient | None = None,
) -> RetrievalRefreshRun:
    sources = _select_refresh_sources(session, payload)
    if not sources:
        raise RetrievalInputError("没有找到可刷新的资料源。")
    client = _resolve_embedding_client(embedding_client)
    embedding_result: EmbeddingResult | None = None
    for source in sources:
        embedding_result = _sync_source_chunks(source, client)
    session.flush()
    chunk_refs = [
        {"source_id": chunk.source_id, "chunk_id": chunk.id, "chunk_index": chunk.chunk_index}
        for source in sources
        for chunk in sorted(source.chunks, key=lambda item: item.chunk_index)
    ]
    payload_metadata: dict[str, object] = {"source_ids": [source.id for source in sources], "chunk_refs": chunk_refs}
    if embedding_result is not None:
        payload_metadata.update(
            {
                "embedding_provider": embedding_result.provider_name,
                "embedding_model": embedding_result.model_name,
                "credential_status": embedding_result.credential_status,
            }
        )
    refresh_run = RetrievalRefreshRun(
        source_id=payload.source_id,
        book_id=payload.book_id,
        series_id=payload.series_id,
        status="completed",
        chunk_count=sum(len(source.chunks) for source in sources),
        payload=payload_metadata,
    )
    session.add(refresh_run)
    session.commit()
    session.refresh(refresh_run)
    return refresh_run


def _require_scope(session: Session, book_id: int | None, series_id: int | None) -> None:
    try:
        validate_scope(session, None, book_id)
    except ScopeNotFoundError as exc:
        raise RetrievalInputError("作品不存在，无法创建检索资料源。") from exc
    if series_id is not None and session.get(Series, series_id) is None:
        raise RetrievalInputError("系列不存在，无法创建检索资料源。")


def _select_refresh_sources(session: Session, payload: RetrievalRefreshRunCreate) -> list[RetrievalSource]:
    statement = select(RetrievalSource).options(selectinload(RetrievalSource.chunks)).order_by(RetrievalSource.id)
    if payload.source_id is not None:
        source = session.get(RetrievalSource, payload.source_id)
        return [] if source is None else [_load_source(session, source.id)]
    if payload.book_id is not None:
        try:
            validate_scope(session, None, payload.book_id)
        except ScopeNotFoundError as exc:
            raise RetrievalInputError("作品不存在，无法刷新检索资料源。") from exc
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


def _sync_source_chunks(source: RetrievalSource, embedding_client: EmbeddingClient) -> EmbeddingResult:
    source.chunks.clear()
    contents = _chunk_text(source.content_text)
    embedding_result = embedding_client.embed_texts(contents)
    for index, (content, embedding) in enumerate(zip(contents, embedding_result.vectors, strict=True), start=1):
        source.chunks.append(
            RetrievalChunk(
                chunk_index=index,
                content=content,
                token_count=max(1, (len(content) + 5) // 6),
                keywords=_keywords(content),
                embedding=embedding,
            )
        )
    return embedding_result


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


def _resolve_embedding_client(embedding_client: EmbeddingClient | None) -> EmbeddingClient:
    return embedding_client if embedding_client is not None else LocalEmbeddingClient()


def _embed_query(raw_query: str, embedding_client: EmbeddingClient | None) -> list[float] | None:
    if embedding_client is None:
        return None
    result = embedding_client.embed_texts([raw_query])
    return result.vectors[0] if result.vectors else None
