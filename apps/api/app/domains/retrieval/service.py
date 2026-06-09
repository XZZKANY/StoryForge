from __future__ import annotations

import logging
import os
import re
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session, selectinload

from app.common.exceptions import InputError
from app.common.scope import ScopeNotFoundError, validate_scope
from app.domains.retrieval.embedding_client import EmbeddingClient, EmbeddingResult, LocalEmbeddingClient
from app.domains.retrieval.models import RetrievalChunk, RetrievalRefreshRun, RetrievalSource
from app.domains.retrieval.pgvector import PGVECTOR_ENGAGED, evaluate_pgvector_decision, pgvector_dimensions
from app.domains.retrieval.reranker_client import RerankerClient
from app.domains.retrieval.schemas import (
    RetrievalHitRead,
    RetrievalRefreshRunCreate,
    RetrievalSearchCreate,
    RetrievalSourceCreate,
    RetrievalWorkbenchHitRead,
    RetrievalWorkbenchRefreshRunRead,
    RetrievalWorkbenchSearchRead,
    RetrievalWorkbenchSourceRead,
)
from app.domains.series.models import Series

logger = logging.getLogger(__name__)

DEFAULT_VECTOR_CANDIDATE_MULTIPLIER = 8
DEFAULT_MIN_VECTOR_CANDIDATES = 32
DEFAULT_PGVECTOR_DIMENSIONS = 1536
DEFAULT_RERANK_CANDIDATE_MULTIPLIER = 5
DEFAULT_MIN_RERANK_CANDIDATES = 50

RetrievalScore = tuple[float, float, float, str]


@dataclass(frozen=True)
class SearchCandidateLoad:
    """检索候选加载摘要，用于后续观测候选裁剪效果。"""

    chunks: list[RetrievalChunk]
    prefilter_enabled: bool
    prefilter_terms: tuple[str, ...]
    filtered_count: int
    fallback_used: bool
    pgvector_enabled: bool = False
    vector_candidate_limit: int | None = None


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


def list_retrieval_workbench_sources(
    session: Session,
    book_id: int | None = None,
    series_id: int | None = None,
) -> list[RetrievalWorkbenchSourceRead]:
    rows = _list_workbench_source_rows(session, book_id=book_id, series_id=series_id)
    return [
        _build_workbench_source(source, latest_refresh, int(chunk_count or 0))
        for source, chunk_count, latest_refresh in rows
    ]


def _list_workbench_source_rows(
    session: Session,
    book_id: int | None = None,
    series_id: int | None = None,
):
    chunk_counts = (
        select(
            RetrievalChunk.source_id.label("source_id"),
            func.count(RetrievalChunk.id).label("chunk_count"),
        )
        .group_by(RetrievalChunk.source_id)
        .subquery()
    )
    latest_run_ids = (
        select(
            RetrievalRefreshRun.source_id.label("source_id"),
            func.max(RetrievalRefreshRun.id).label("latest_run_id"),
        )
        .where(RetrievalRefreshRun.source_id.is_not(None))
        .group_by(RetrievalRefreshRun.source_id)
        .subquery()
    )
    statement = (
        select(
            RetrievalSource,
            func.coalesce(chunk_counts.c.chunk_count, 0).label("chunk_count"),
            RetrievalRefreshRun,
        )
        .outerjoin(chunk_counts, chunk_counts.c.source_id == RetrievalSource.id)
        .outerjoin(latest_run_ids, latest_run_ids.c.source_id == RetrievalSource.id)
        .outerjoin(RetrievalRefreshRun, RetrievalRefreshRun.id == latest_run_ids.c.latest_run_id)
        .order_by(RetrievalSource.id)
    )
    if book_id is not None:
        statement = statement.where(RetrievalSource.book_id == book_id)
    if series_id is not None:
        statement = statement.where(RetrievalSource.series_id == series_id)
    return session.execute(statement).all()


def list_retrieval_workbench_refresh_runs(
    session: Session,
    source_id: int | None = None,
    book_id: int | None = None,
    series_id: int | None = None,
) -> list[RetrievalWorkbenchRefreshRunRead]:
    statement = select(RetrievalRefreshRun).order_by(RetrievalRefreshRun.id.desc())
    if source_id is not None:
        statement = statement.where(RetrievalRefreshRun.source_id == source_id)
    if book_id is not None:
        statement = statement.where(RetrievalRefreshRun.book_id == book_id)
    if series_id is not None:
        statement = statement.where(RetrievalRefreshRun.series_id == series_id)
    return [_build_workbench_refresh_run(run) for run in session.scalars(statement).all()]


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
    query_terms = _keywords(payload.query)
    query_embedding = _embed_query(payload.query, embedding_client)
    candidate_load = _load_search_candidates(
        session,
        statement,
        payload.query,
        query_terms,
        use_keyword_prefilter=embedding_client is None,
        query_embedding=query_embedding,
        limit=payload.limit,
    )
    _log_search_candidate_load(candidate_load)
    chunks = candidate_load.chunks
    scored: list[tuple[RetrievalScore, RetrievalChunk]] = []
    for chunk in chunks:
        score = _score_chunk(chunk, query_terms, payload.query, query_embedding)
        if score[0] > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda item: (-item[0][0], item[1].source_id, item[1].chunk_index, item[1].id))
    rerank_window = _rerank_window_size(payload.limit) if reranker_client is not None else payload.limit
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
        for rank, (score, chunk) in enumerate(scored[:rerank_window], start=1)
    ]
    reranked = _apply_reranker(payload.query, hits, reranker_client)
    return reranked[: payload.limit]


def _rerank_window_size(limit: int) -> int:
    multiplier = _positive_int_env(
        "STORYFORGE_RETRIEVAL_RERANK_CANDIDATE_MULTIPLIER",
        DEFAULT_RERANK_CANDIDATE_MULTIPLIER,
    )
    min_candidates = _positive_int_env(
        "STORYFORGE_RETRIEVAL_RERANK_MIN_CANDIDATES",
        DEFAULT_MIN_RERANK_CANDIDATES,
    )
    return max(limit * multiplier, min_candidates)


def _log_search_candidate_load(candidate_load: SearchCandidateLoad) -> None:
    logger.info(
        "检索候选加载摘要",
        extra={
            "candidate_count": len(candidate_load.chunks),
            "filtered_count": candidate_load.filtered_count,
            "prefilter_enabled": candidate_load.prefilter_enabled,
            "fallback_used": candidate_load.fallback_used,
            "pgvector_enabled": candidate_load.pgvector_enabled,
            "vector_candidate_limit": candidate_load.vector_candidate_limit,
        },
    )


def _load_search_candidates(
    session: Session,
    statement,
    raw_query: str,
    query_terms: Sequence[str],
    *,
    use_keyword_prefilter: bool,
    query_embedding: Sequence[float] | None = None,
    limit: int | None = None,
) -> SearchCandidateLoad:
    if not use_keyword_prefilter:
        if _should_use_pgvector_candidates(session, query_embedding):
            candidate_limit = _vector_candidate_limit(limit)
            vector_statement = _apply_pgvector_candidate_order(statement, candidate_limit)
            chunks = list(
                session.scalars(vector_statement, {"query_embedding": _pgvector_literal(query_embedding or [])}).all()
            )
            return SearchCandidateLoad(
                chunks=chunks,
                prefilter_enabled=False,
                prefilter_terms=(),
                filtered_count=len(chunks),
                fallback_used=False,
                pgvector_enabled=True,
                vector_candidate_limit=candidate_limit,
            )
        chunks = list(session.scalars(statement).all())
        return SearchCandidateLoad(
            chunks=chunks,
            prefilter_enabled=False,
            prefilter_terms=(),
            filtered_count=len(chunks),
            fallback_used=False,
        )
    terms = tuple(_keyword_prefilter_terms(raw_query, query_terms))
    filtered_statement = _apply_keyword_candidate_filter(statement, terms)
    chunks = list(session.scalars(filtered_statement).all())
    if chunks:
        return SearchCandidateLoad(
            chunks=chunks,
            prefilter_enabled=True,
            prefilter_terms=terms,
            filtered_count=len(chunks),
            fallback_used=False,
        )
    fallback_chunks = list(session.scalars(statement).all())
    return SearchCandidateLoad(
        chunks=fallback_chunks,
        prefilter_enabled=True,
        prefilter_terms=terms,
        filtered_count=0,
        fallback_used=True,
    )


def _should_use_pgvector_candidates(session: Session, query_embedding: Sequence[float] | None) -> bool:
    expected_dims = _pgvector_dimensions()
    reason = evaluate_pgvector_decision(session, query_embedding, expected_dims=expected_dims)
    if reason != PGVECTOR_ENGAGED and query_embedding is not None:
        logger.info(
            "retrieval pgvector 未启用，回退关键词候选：reason=%s expected_dims=%s got_dims=%s",
            reason,
            expected_dims,
            len(query_embedding),
        )
    return reason == PGVECTOR_ENGAGED


def _pgvector_dimensions() -> int:
    return pgvector_dimensions("STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS", DEFAULT_PGVECTOR_DIMENSIONS)


def _vector_candidate_limit(limit: int | None) -> int:
    multiplier = _positive_int_env(
        "STORYFORGE_RETRIEVAL_VECTOR_CANDIDATE_MULTIPLIER",
        DEFAULT_VECTOR_CANDIDATE_MULTIPLIER,
    )
    min_candidates = _positive_int_env(
        "STORYFORGE_RETRIEVAL_VECTOR_MIN_CANDIDATES",
        DEFAULT_MIN_VECTOR_CANDIDATES,
    )
    if limit is None:
        return min_candidates
    return max(limit * multiplier, min_candidates)


def _positive_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        value = int(raw_value)
    except ValueError:
        return default
    return value if value > 0 else default


def _pgvector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in values) + "]"


def _apply_pgvector_candidate_order(statement, candidate_limit: int):
    distance_order = text("retrieval_chunks.embedding_vector <=> CAST(:query_embedding AS vector)")
    return statement.order_by(None).order_by(distance_order).limit(candidate_limit)


def _apply_keyword_candidate_filter(statement, terms: Sequence[str]):
    if not terms:
        return statement
    conditions = []
    for term in terms:
        pattern = f"%{term}%"
        conditions.append(RetrievalChunk.content.ilike(pattern))
        conditions.append(RetrievalSource.title.ilike(pattern))
    return statement.where(or_(*conditions))


def _keyword_prefilter_terms(raw_query: str, query_terms: Sequence[str]) -> list[str]:
    candidates = [raw_query.strip(), *query_terms]
    seen: set[str] = set()
    terms: list[str] = []
    for candidate in candidates:
        normalized = candidate.strip().lower()
        if len(normalized) < 2 or normalized in seen:
            continue
        seen.add(normalized)
        terms.append(normalized)
        if len(terms) >= 8:
            break
    return terms


def search_retrieval_workbench(
    session: Session,
    payload: RetrievalSearchCreate,
    embedding_client: EmbeddingClient | None = None,
    reranker_client: RerankerClient | None = None,
) -> RetrievalWorkbenchSearchRead:
    hits = search_retrieval(
        session,
        payload,
        embedding_client=embedding_client,
        reranker_client=reranker_client,
    )
    return RetrievalWorkbenchSearchRead(
        query=payload.query,
        hits=[_build_workbench_hit(hit) for hit in hits],
    )



def _build_workbench_source(
    source: RetrievalSource,
    latest_refresh: RetrievalRefreshRun | None = None,
    chunk_count: int | None = None,
) -> RetrievalWorkbenchSourceRead:
    return RetrievalWorkbenchSourceRead(
        id=source.id,
        book_id=source.book_id,
        series_id=source.series_id,
        source_type=source.source_type,
        title=source.title,
        status=source.status,
        chunk_count=source.chunk_count if chunk_count is None else chunk_count,
        refresh_status=latest_refresh.status if latest_refresh is not None else "not_refreshed",
        evidence_anchor=f"retrieval-source-{source.id}",
    )


def _build_workbench_refresh_run(run: RetrievalRefreshRun) -> RetrievalWorkbenchRefreshRunRead:
    source_ids = run.payload.get("source_ids", [])
    return RetrievalWorkbenchRefreshRunRead(
        id=run.id,
        source_id=run.source_id,
        book_id=run.book_id,
        series_id=run.series_id,
        status=run.status,
        chunk_count=run.chunk_count,
        embedding_provider=run.payload.get("embedding_provider"),
        embedding_model=run.payload.get("embedding_model"),
        credential_status=run.payload.get("credential_status"),
        source_ids=[source_id for source_id in source_ids if isinstance(source_id, int)],
    )


def _build_workbench_hit(hit: RetrievalHitRead) -> RetrievalWorkbenchHitRead:
    return RetrievalWorkbenchHitRead(
        **hit.model_dump(),
        evidence_href=f"#retrieval-evidence-{hit.source_id}-{hit.chunk_id}",
    )


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


def _keywords(value: str) -> list[str]:
    parts = [part.lower() for part in re.split(r"[^0-9A-Za-z\u4e00-\u9fff]+", value) if part.strip()]
    seen: set[str] = set()
    keywords: list[str] = []
    for part in parts:
        for candidate in _expand_keyword_candidates(part):
            if candidate in seen:
                continue
            seen.add(candidate)
            keywords.append(candidate)
    return keywords


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
    chunk_keywords = set(chunk.keywords)
    overlap = sum(1 for term in query_terms if term in chunk_keywords or term in chunk_text)
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
    dot = 0.0
    left_norm_squared = 0.0
    right_norm_squared = 0.0
    for left_value, right_value in zip(left, right, strict=False):
        dot += left_value * right_value
        left_norm_squared += left_value * left_value
        right_norm_squared += right_value * right_value
    if left_norm_squared == 0 or right_norm_squared == 0:
        return 0.0
    return round(dot / ((left_norm_squared**0.5) * (right_norm_squared**0.5)), 4)
