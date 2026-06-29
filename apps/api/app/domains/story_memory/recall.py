from __future__ import annotations

import logging
import os

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.books.models import Chapter
from app.domains.continuity.models import ContinuityRecord
from app.domains.retrieval.embedding_client import EmbeddingClient
from app.domains.retrieval.pgvector import PGVECTOR_ENGAGED, evaluate_pgvector_decision, pgvector_dimensions
from app.domains.retrieval.service import _cosine_similarity
from app.domains.story_memory.atoms import (
    _memory_atom_default_order,
    _memory_atom_embedding_text,
    _record_to_atom,
)
from app.domains.story_memory.models import MemoryAtomRecord
from app.domains.story_memory.schemas import MemoryAtom

logger = logging.getLogger("app.domains.story_memory.service")

DEFAULT_MEMORY_PGVECTOR_DIMENSIONS = 1536
DEFAULT_MEMORY_VECTOR_CANDIDATE_MULTIPLIER = 8
DEFAULT_MEMORY_VECTOR_MIN_CANDIDATES = 32
MemoryRecallScore = tuple[float, float, float, int, str]


def recall_scene_memory_atoms(
    session: Session,
    *,
    book_id: int,
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
    embedding_client: EmbeddingClient | None = None,
    limit: int = 12,
) -> list[MemoryAtom]:
    """按 POV、地点、活跃角色和前章约束召回当前场景需要的长效记忆。"""

    candidate_terms = _scene_memory_terms(chapter, assets, continuity_records)
    query_embedding = _memory_query_embedding(candidate_terms, embedding_client)
    active_atoms = _get_active_memory_atom_candidates(
        session,
        book_id=book_id,
        chapter_ordinal=chapter.ordinal,
        query_embedding=query_embedding,
        limit=limit,
    )
    if not active_atoms:
        return []
    scored = _score_scene_memory_atoms(active_atoms, candidate_terms, chapter, embedding_client, query_embedding)
    return [atom for _, atom in sorted(scored, key=_memory_recall_sort_key)[:limit]]


def _scene_memory_terms(
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
) -> list[str]:
    terms: list[str] = []
    for value in (chapter.pov, chapter.location, chapter.summary):
        _append_term(terms, value)
    for asset in assets:
        if asset.asset_type == "character":
            _append_term(terms, asset.name)
        for raw_value in asset.payload.values():
            if isinstance(raw_value, str):
                _append_term(terms, raw_value)
            elif isinstance(raw_value, list):
                for item in raw_value:
                    _append_term(terms, str(item))
    for record in continuity_records:
        raw_value = record.payload.get("value")
        if isinstance(raw_value, list):
            for item in raw_value:
                _append_term(terms, str(item))
        elif raw_value is not None:
            _append_term(terms, str(raw_value))
    return terms


def _append_term(terms: list[str], value: str | None) -> None:
    if value is None:
        return
    normalized = value.strip()
    if normalized and normalized not in terms:
        terms.append(normalized)


def _memory_atom_matches_scene(atom: MemoryAtom, candidate_terms: list[str]) -> bool:
    haystack = f"{atom.entity_id} {atom.value} {atom.source_ref}"
    return any(term in haystack or atom.entity_id in term for term in candidate_terms)


def _get_active_memory_atom_candidates(
    session: Session,
    *,
    book_id: int,
    chapter_ordinal: int,
    query_embedding: list[float] | None,
    limit: int,
) -> list[MemoryAtom]:
    statement = select(MemoryAtomRecord).where(
        MemoryAtomRecord.book_id == book_id,
        MemoryAtomRecord.valid_from_chapter <= chapter_ordinal,
        (MemoryAtomRecord.valid_to_chapter.is_(None) | (MemoryAtomRecord.valid_to_chapter >= chapter_ordinal)),
    )
    records = _load_memory_atom_candidates(
        session,
        statement,
        query_embedding=query_embedding,
        limit=limit,
    )
    return [_record_to_atom(record) for record in records]


def _load_memory_atom_candidates(
    session: Session,
    statement,
    *,
    query_embedding: list[float] | None = None,
    limit: int | None = None,
) -> list[MemoryAtomRecord]:
    expected_dims = _memory_pgvector_dimensions()
    reason = evaluate_pgvector_decision(session, query_embedding, expected_dims=expected_dims)
    if reason == PGVECTOR_ENGAGED:
        candidate_limit = _memory_vector_candidate_limit(limit)
        vector_statement = _apply_memory_pgvector_candidate_order(statement, candidate_limit)
        records = list(
            session.scalars(vector_statement, {"query_embedding": _pgvector_literal(query_embedding or [])}).all()
        )
        logger.debug("memory pgvector 召回已启用：candidate_limit=%s got=%s", candidate_limit, len(records))
        return records
    if query_embedding is not None:
        logger.info(
            "memory pgvector 未启用，回退默认排序召回：reason=%s expected_dims=%s got_dims=%s",
            reason,
            expected_dims,
            len(query_embedding),
        )
    return list(session.scalars(_memory_atom_default_order(statement)).all())


def _memory_pgvector_dimensions() -> int:
    return pgvector_dimensions("STORYFORGE_MEMORY_PGVECTOR_DIMENSIONS", DEFAULT_MEMORY_PGVECTOR_DIMENSIONS)


def _memory_vector_candidate_limit(limit: int | None) -> int:
    multiplier = _positive_int_env(
        "STORYFORGE_MEMORY_VECTOR_CANDIDATE_MULTIPLIER",
        DEFAULT_MEMORY_VECTOR_CANDIDATE_MULTIPLIER,
    )
    min_candidates = _positive_int_env(
        "STORYFORGE_MEMORY_VECTOR_MIN_CANDIDATES",
        DEFAULT_MEMORY_VECTOR_MIN_CANDIDATES,
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


def _pgvector_literal(values: list[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in values) + "]"


def _apply_memory_pgvector_candidate_order(statement, candidate_limit: int):
    distance_order = text("memory_atoms.embedding_vector <=> CAST(:query_embedding AS vector)")
    return statement.order_by(None).order_by(distance_order).limit(candidate_limit)


def _memory_query_embedding(candidate_terms: list[str], embedding_client: EmbeddingClient | None) -> list[float] | None:
    query = " ".join(candidate_terms).strip()
    if embedding_client is None or not query:
        return None
    result = embedding_client.embed_texts([query])
    if not result.vectors:
        return None
    return result.vectors[0]


def _score_scene_memory_atoms(
    atoms: list[MemoryAtom],
    candidate_terms: list[str],
    chapter: Chapter,
    embedding_client: EmbeddingClient | None,
    query_embedding: list[float] | None = None,
) -> list[tuple[MemoryRecallScore, MemoryAtom]]:
    semantic_scores = _semantic_memory_scores(atoms, candidate_terms, embedding_client, query_embedding)
    scored: list[tuple[MemoryRecallScore, MemoryAtom]] = []
    for atom in atoms:
        keyword_score = _keyword_memory_score(atom, candidate_terms)
        semantic_score = semantic_scores.get(atom.memory_id, 0.0)
        if keyword_score <= 0 and semantic_score <= 0.25:
            continue
        recency_score = 1.0 / max(1, chapter.ordinal - atom.valid_from_chapter + 1)
        immutable_score = 1.0 if atom.immutable else 0.0
        total = keyword_score + semantic_score + (0.15 * recency_score) + (0.1 * immutable_score)
        scored.append(((total, semantic_score, keyword_score, _term_rank(atom.entity_id, candidate_terms), atom.memory_id), atom))
    return scored


def _semantic_memory_scores(
    atoms: list[MemoryAtom],
    candidate_terms: list[str],
    embedding_client: EmbeddingClient | None,
    query_embedding: list[float] | None = None,
) -> dict[str, float]:
    query = " ".join(candidate_terms).strip()
    if not query:
        return {}
    if query_embedding is None:
        if embedding_client is None:
            return {}
        query_result = embedding_client.embed_texts([query])
        if not query_result.vectors:
            return {}
        query_embedding = query_result.vectors[0]

    scores: dict[str, float] = {}
    missing_atoms: list[MemoryAtom] = []
    for atom in atoms:
        if atom.embedding:
            scores[atom.memory_id] = _cosine_similarity(query_embedding, atom.embedding)
        else:
            missing_atoms.append(atom)
    if not missing_atoms:
        return scores
    if embedding_client is None:
        return scores

    missing_texts = [_memory_atom_embedding_text(atom) for atom in missing_atoms]
    missing_result = embedding_client.embed_texts(missing_texts)
    if len(missing_result.vectors) != len(missing_atoms):
        return scores
    for atom, embedding in zip(missing_atoms, missing_result.vectors, strict=False):
        scores[atom.memory_id] = _cosine_similarity(query_embedding, embedding)
    return scores


def _keyword_memory_score(atom: MemoryAtom, candidate_terms: list[str]) -> float:
    if not _memory_atom_matches_scene(atom, candidate_terms):
        return 0.0
    return 1.0 + (0.25 if _term_rank(atom.entity_id, candidate_terms) < len(candidate_terms) else 0.0)


def _memory_recall_sort_key(item: tuple[MemoryRecallScore, MemoryAtom]) -> tuple[float, float, float, int, str]:
    score, atom = item
    total, semantic_score, keyword_score, term_rank, memory_id = score
    return (-total, -semantic_score, -keyword_score, term_rank, atom.entity_type, atom.fact_type, memory_id)


def _term_rank(entity_id: str, candidate_terms: list[str]) -> int:
    for index, term in enumerate(candidate_terms):
        if entity_id == term or entity_id in term or term in entity_id:
            return index
    return len(candidate_terms)
