from __future__ import annotations

import re

from app.domains.retrieval.models import RetrievalChunk
from app.domains.retrieval.reranker_client import RerankerClient
from app.domains.retrieval.schemas import RetrievalHitRead

DEFAULT_RERANK_CANDIDATE_MULTIPLIER = 5
DEFAULT_MIN_RERANK_CANDIDATES = 50

RetrievalScore = tuple[float, float, float, str]


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


def _rerank_window_size(limit: int) -> int:
    from app.domains.retrieval.candidate_loader import _positive_int_env

    multiplier = _positive_int_env(
        "STORYFORGE_RETRIEVAL_RERANK_CANDIDATE_MULTIPLIER",
        DEFAULT_RERANK_CANDIDATE_MULTIPLIER,
    )
    min_candidates = _positive_int_env(
        "STORYFORGE_RETRIEVAL_RERANK_MIN_CANDIDATES",
        DEFAULT_MIN_RERANK_CANDIDATES,
    )
    return max(limit * multiplier, min_candidates)


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
