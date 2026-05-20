from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.common.exceptions import NotFoundError

from app.domains.assets.models import Asset
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.retrieval.schemas import RetrievalHitRead, RetrievalSearchCreate
from app.domains.retrieval.service import search_retrieval
from app.domains.scene_packets.assembly import (
    filter_continuity_records_for_chapter as _filter_continuity_records_for_chapter,
    load_active_assets as _load_active_assets,
    load_evidence_links as _load_evidence_links,
)
from app.domains.scene_packets.budget import build_packet as _build_packet, estimate_tokens as _estimate_tokens
from app.domains.scene_packets.retrieval_bridge import (
    attach_compiled_context as _attach_compiled_context,
    build_retrieval_query as _build_retrieval_query,
    retrieval_context_blocks as _retrieval_context_blocks,
)
from app.domains.scene_packets.schemas import EvidenceLinkRead, ScenePacketCreate, ScenePacketRead


class ScenePacketInputError(NotFoundError):
    """上下文包输入无法定位作品、章节或资产时抛出。"""


def assemble_scene_packet(session: Session, payload: ScenePacketCreate) -> ScenePacketRead:
    """先装配结构化资产和连续性摘要，再按预算加入检索片段。"""

    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None or chapter.book_id != payload.book_id:
        raise ScenePacketInputError("章节不存在或不属于指定作品，无法组装 Scene Packet。")

    scene = session.scalars(
        select(Scene).where(Scene.chapter_id == chapter.id).order_by(Scene.ordinal, Scene.id).limit(1)
    ).first()
    if scene is None:
        raise ScenePacketInputError("章节下没有场景，无法组装 Scene Packet。")

    assets = _load_active_assets(session, payload)
    if len(assets) != len(set(payload.active_asset_ids)):
        raise ScenePacketInputError("存在不属于该作品的活跃资产，无法组装 Scene Packet。")

    continuity_records = session.scalars(
        select(ContinuityRecord)
        .where(ContinuityRecord.book_id == payload.book_id, ContinuityRecord.status == "active")
        .order_by(ContinuityRecord.id)
    ).all()
    continuity_records = _filter_continuity_records_for_chapter(continuity_records, payload.chapter_id)
    evidence_links = _load_evidence_links(session, scene.id, assets)
    retrieval_hits: list[RetrievalHitRead] = []

    if not payload.retrieval_snippets:
        retrieval_query = _build_retrieval_query(payload, chapter, assets, continuity_records)
        retrieval_hits = search_retrieval(
            session,
            RetrievalSearchCreate(
                query=retrieval_query,
                book_id=payload.book_id,
                limit=3,
            ),
        )
        payload = payload.model_copy(update={"retrieval_snippets": [hit.excerpt for hit in retrieval_hits]})
        evidence_links.extend(
            [
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
                    context_tokens=_estimate_tokens(hit.excerpt),
                )
                for hit in retrieval_hits
            ]
        )

    packet, budget_statistics = _build_packet(payload, chapter, assets, continuity_records, evidence_links)
    if retrieval_hits:
        packet["检索命中"] = [hit.model_dump() for hit in retrieval_hits]
    _attach_compiled_context(session, packet, payload, chapter, scene, assets, continuity_records, retrieval_hits)

    scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet=packet, version=1)
    session.add(scene_packet)
    session.commit()
    session.refresh(scene_packet)

    return ScenePacketRead(
        id=scene_packet.id,
        scene_id=scene_packet.scene_id,
        status=scene_packet.status,
        packet=scene_packet.packet,
        budget_statistics=budget_statistics,
        evidence_links=evidence_links,
        version=scene_packet.version,
        created_at=scene_packet.created_at,
        updated_at=scene_packet.updated_at,
    )
