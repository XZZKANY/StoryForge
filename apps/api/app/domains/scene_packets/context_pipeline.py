from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ContinuityRecord
from app.domains.retrieval.schemas import RetrievalHitRead, RetrievalSearchCreate
from app.domains.retrieval.service import search_retrieval
from app.domains.scene_packets.budget import build_packet, estimate_tokens
from app.domains.scene_packets.retrieval_bridge import attach_compiled_context, build_retrieval_query
from app.domains.scene_packets.schemas import BudgetStatistics, EvidenceLinkRead, ScenePacketCreate


@dataclass(frozen=True)
class SceneContextAssembly:
    """Scene Packet 上下文装配结果，隔离检索、预算和 compiled context 细节。"""

    packet: dict[str, object]
    budget_statistics: BudgetStatistics
    evidence_links: list[EvidenceLinkRead]
    retrieval_hits: list[RetrievalHitRead]


def assemble_scene_context(
    *,
    session: Session,
    payload: ScenePacketCreate,
    chapter: Chapter,
    scene: Scene,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
    evidence_links: list[EvidenceLinkRead],
) -> SceneContextAssembly:
    """组装 Scene Packet 上下文，保持服务层只处理实体定位和持久化。"""

    scoped_evidence_links = list(evidence_links)
    retrieval_hits, payload_with_retrieval = _resolve_retrieval_context(
        session=session,
        payload=payload,
        chapter=chapter,
        assets=assets,
        continuity_records=continuity_records,
    )
    scoped_evidence_links.extend(retrieval_evidence_links(retrieval_hits))
    packet, budget_statistics = build_packet(
        payload_with_retrieval,
        chapter,
        assets,
        continuity_records,
        scoped_evidence_links,
    )
    if retrieval_hits:
        packet["检索命中"] = [hit.model_dump() for hit in retrieval_hits]
    attach_compiled_context(
        session,
        packet,
        payload_with_retrieval,
        chapter,
        scene,
        assets,
        continuity_records,
        retrieval_hits,
    )
    return SceneContextAssembly(
        packet=packet,
        budget_statistics=budget_statistics,
        evidence_links=scoped_evidence_links,
        retrieval_hits=retrieval_hits,
    )


def retrieval_evidence_links(retrieval_hits: list[RetrievalHitRead]) -> list[EvidenceLinkRead]:
    """把检索命中转换为 Scene Packet 证据链接。"""

    return [
        EvidenceLinkRead(
            asset_id=0,
            evidence_type="retrieval_hit",
            source_ref=hit.source_ref,
            rationale=f"检索命中 #{hit.rank}：{hit.title}",
            score=hit.score,
            rank=hit.rank,
            source_id=hit.source_id,
            chunk_id=hit.chunk_id,
            score_source=hit.score_source,
            keyword_score=hit.keyword_score,
            embedding_score=hit.embedding_score,
            rerank_score=hit.rerank_score,
            rerank_provider=hit.rerank_provider,
            rerank_model=hit.rerank_model,
            context_tokens=estimate_tokens(hit.excerpt),
        )
        for hit in retrieval_hits
    ]


def _resolve_retrieval_context(
    *,
    session: Session,
    payload: ScenePacketCreate,
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
) -> tuple[list[RetrievalHitRead], ScenePacketCreate]:
    """缺少手工检索片段时执行检索，并返回带片段的 payload 副本。"""

    if payload.retrieval_snippets:
        return [], payload

    retrieval_query = build_retrieval_query(payload, chapter, assets, continuity_records)
    retrieval_hits = search_retrieval(
        session,
        RetrievalSearchCreate(
            query=retrieval_query,
            book_id=payload.book_id,
            limit=3,
        ),
    )
    payload_with_retrieval = payload.model_copy(update={"retrieval_snippets": [hit.excerpt for hit in retrieval_hits]})
    return retrieval_hits, payload_with_retrieval
