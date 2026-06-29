from __future__ import annotations

import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.domains.retrieval.models import RetrievalChunk, RetrievalSource
from app.domains.retrieval.pgvector import PGVECTOR_ENGAGED, evaluate_pgvector_decision, pgvector_dimensions

logger = logging.getLogger("app.domains.retrieval.service")

DEFAULT_VECTOR_CANDIDATE_MULTIPLIER = 8
DEFAULT_MIN_VECTOR_CANDIDATES = 32
DEFAULT_PGVECTOR_DIMENSIONS = 1536


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
