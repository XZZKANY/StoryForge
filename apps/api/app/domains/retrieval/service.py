from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domains.retrieval.candidate_loader import (  # noqa: F401  facade re-export
    DEFAULT_MIN_VECTOR_CANDIDATES,
    DEFAULT_PGVECTOR_DIMENSIONS,
    DEFAULT_VECTOR_CANDIDATE_MULTIPLIER,
    SearchCandidateLoad,
    _apply_keyword_candidate_filter,
    _apply_pgvector_candidate_order,
    _keyword_prefilter_terms,
    _load_search_candidates,
    _log_search_candidate_load,
    _pgvector_dimensions,
    _pgvector_literal,
    _positive_int_env,
    _should_use_pgvector_candidates,
    _vector_candidate_limit,
)
from app.domains.retrieval.embedding_client import EmbeddingClient
from app.domains.retrieval.indexing import (  # noqa: F401  facade re-export
    RetrievalInputError,
    _chunk_text,
    _embed_query,
    _load_source,
    _require_scope,
    _resolve_embedding_client,
    _select_refresh_sources,
    _sync_source_chunks,
    create_retrieval_refresh_run,
    create_retrieval_source,
    list_retrieval_sources,
)
from app.domains.retrieval.models import RetrievalChunk, RetrievalSource
from app.domains.retrieval.reranker_client import RerankerClient
from app.domains.retrieval.schemas import (
    RetrievalHitRead,
    RetrievalSearchCreate,
    RetrievalWorkbenchSearchRead,
)
from app.domains.retrieval.scoring import (  # noqa: F401  facade re-export
    DEFAULT_MIN_RERANK_CANDIDATES,
    DEFAULT_RERANK_CANDIDATE_MULTIPLIER,
    RetrievalScore,
    _apply_reranker,
    _cosine_similarity,
    _expand_keyword_candidates,
    _keywords,
    _rerank_window_size,
    _score_chunk,
)
from app.domains.retrieval.workbench import (  # noqa: F401  facade re-export
    _build_workbench_hit,
    _build_workbench_refresh_run,
    _build_workbench_source,
    _list_workbench_source_rows,
    list_retrieval_workbench_refresh_runs,
    list_retrieval_workbench_sources,
)


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
