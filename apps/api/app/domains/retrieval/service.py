from __future__ import annotations

import re
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domains.books.models import Book
from app.domains.retrieval.embedding_client import EmbeddingClient, EmbeddingResult, LocalEmbeddingClient
from app.domains.retrieval.models import RetrievalChunk, RetrievalRefreshRun, RetrievalSource
from app.domains.retrieval.reranker_client import RerankerClient
from app.domains.retrieval.schemas import (
    RetrievalHitRead,
    RetrievalRefreshRunCreate,
    RetrievalSearchCreate,
    RetrievalSourceCreate,
)
from app.domains.series.models import Series

RetrievalScore = tuple[float, float, float, str]


class RetrievalInputError(ValueError):
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
        payload=payload.payload,
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


def search_retrieval(
    session: Session,
    payload: RetrievalSearchCreate,
    embedding_client: EmbeddingClient | None = None,
    reranker_client: RerankerClient | None = None,
) -> list[RetrievalHitRead]:
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
    query_embedding = _embed_query(payload.query, embedding_client)
    scored: list[tuple[RetrievalScore, RetrievalChunk]] = []
    for chunk in chunks:
        score = _score_chunk(chunk, query_terms, payload.query, query_embedding)
        if score[0] > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda item: (-item[0][0], item[1].source_id, item[1].chunk_index, item[1].id))
    hits = [
        RetrievalHitRead(
            source_id=chunk.source_id,
            chunk_id=chunk.id,
            source_ref=f"retrieval:{chunk.source_id}:{chunk.id}",
            book_id=chunk.source.book_id,
            series_id=chunk.source.series_id,
            title=chunk.source.title,
            excerpt=chunk.content[:160],
            score=round(score[0], 4),
            rank=rank,
            keyword_score=round(score[1], 4),
            embedding_score=round(score[2], 4),
            score_source=score[3],
        )
        for rank, (score, chunk) in enumerate(scored[: payload.limit], start=1)
    ]
    return _apply_reranker(payload.query, hits, reranker_client)


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


def _resolve_embedding_client(embedding_client: EmbeddingClient | None) -> EmbeddingClient:
    return embedding_client if embedding_client is not None else LocalEmbeddingClient()


def _embed_query(raw_query: str, embedding_client: EmbeddingClient | None) -> list[float] | None:
    if embedding_client is None:
        return None
    result = embedding_client.embed_texts([raw_query])
    return result.vectors[0] if result.vectors else None


def _apply_reranker(
    query: str,
    hits: list[RetrievalHitRead],
    reranker_client: RerankerClient | None,
) -> list[RetrievalHitRead]:
    if reranker_client is None or not hits:
        return hits
    rerank_result = reranker_client.rerank(query, hits)
    scores_by_chunk_id = {item.chunk_id: item.score for item in rerank_result.items}
    if not scores_by_chunk_id:
        return hits
    original_rank_by_chunk_id = {hit.chunk_id: hit.rank for hit in hits}
    reranked = [
        hit.model_copy(
            update={
                "rerank_score": scores_by_chunk_id[hit.chunk_id],
                "rerank_provider": rerank_result.provider_name,
                "rerank_model": rerank_result.model_name,
                "score_source": "rerank",
            }
        )
        if hit.chunk_id in scores_by_chunk_id
        else hit
        for hit in hits
    ]
    reranked.sort(
        key=lambda hit: (
            -(hit.rerank_score if hit.rerank_score is not None else float("-inf")),
            original_rank_by_chunk_id[hit.chunk_id],
        )
    )
    return [hit.model_copy(update={"rank": rank}) for rank, hit in enumerate(reranked, start=1)]


def _score_chunk(
    chunk: RetrievalChunk,
    query_terms: list[str],
    raw_query: str,
    query_embedding: list[float] | None = None,
) -> RetrievalScore:
    chunk_text = chunk.content.lower()
    overlap = sum(1 for term in query_terms if term in chunk.keywords or term in chunk_text)
    embedding_score = _cosine_similarity(query_embedding, chunk.embedding) if query_embedding else 0.0
    if (
        overlap == 0
        and raw_query.lower() not in chunk_text
        and raw_query.lower() not in chunk.source.title.lower()
        and embedding_score <= 0.25
    ):
        return (0.0, 0.0, 0.0, "none")
    bonus = 0.5 if raw_query.lower() in chunk_text else 0.0
    title_bonus = 0.25 if any(term in chunk.source.title.lower() for term in query_terms) else 0.0
    keyword_score = float(overlap) + bonus + title_bonus
    total = keyword_score + embedding_score
    if embedding_score > 0 and keyword_score == 0:
        score_source = "embedding"
    elif embedding_score > 0:
        score_source = "hybrid"
    else:
        score_source = "keyword"
    return (total, keyword_score, embedding_score, score_source)


def _cosine_similarity(left: list[float] | None, right: list[float] | None) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    left_slice = left[:size]
    right_slice = right[:size]
    dot = sum(left_value * right_value for left_value, right_value in zip(left_slice, right_slice, strict=True))
    left_norm = sum(value * value for value in left_slice) ** 0.5
    right_norm = sum(value * value for value in right_slice) ** 0.5
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return round(dot / (left_norm * right_norm), 4)
