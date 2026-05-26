from __future__ import annotations

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import NotFoundError
from app.common.redis_cache import cache_get_value, cache_set_value
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.scene_packets.assembly import (
    filter_continuity_records_for_chapter as _filter_continuity_records_for_chapter,
)
from app.domains.scene_packets.assembly import (
    load_active_assets as _load_active_assets,
)
from app.domains.scene_packets.assembly import (
    load_evidence_links as _load_evidence_links,
)
from app.domains.scene_packets.context_pipeline import assemble_scene_context
from app.domains.scene_packets.schemas import ScenePacketCreate, ScenePacketRead


class ScenePacketInputError(NotFoundError):
    """上下文包输入无法定位作品、章节或资产时抛出。"""


SCENE_PACKET_CACHE_TTL_SECONDS = 120


def assemble_scene_packet(session: Session, payload: ScenePacketCreate) -> ScenePacketRead:
    """先装配结构化资产和连续性摘要，再按预算加入检索片段。"""

    cache_key = _scene_packet_cache_key(payload)
    cached_packet = cache_get_value(cache_key)
    if isinstance(cached_packet, dict):
        cached_packet_id = cached_packet.get("id")
        cached_scene_id = cached_packet.get("scene_id")
        stored_packet = session.get(ScenePacket, cached_packet_id) if isinstance(cached_packet_id, int) else None
        if stored_packet is not None and (
            not isinstance(cached_scene_id, int) or stored_packet.scene_id == cached_scene_id
        ):
            return ScenePacketRead.model_validate(cached_packet)

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
    context_assembly = assemble_scene_context(
        session=session,
        payload=payload,
        chapter=chapter,
        scene=scene,
        assets=assets,
        continuity_records=continuity_records,
        evidence_links=evidence_links,
    )

    scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet=context_assembly.packet, version=1)
    session.add(scene_packet)
    session.commit()
    session.refresh(scene_packet)

    result = ScenePacketRead(
        id=scene_packet.id,
        scene_id=scene_packet.scene_id,
        status=scene_packet.status,
        packet=scene_packet.packet,
        budget_statistics=context_assembly.budget_statistics,
        evidence_links=context_assembly.evidence_links,
        version=scene_packet.version,
        created_at=scene_packet.created_at,
        updated_at=scene_packet.updated_at,
    )
    cache_set_value(cache_key, result.model_dump(mode="json"), SCENE_PACKET_CACHE_TTL_SECONDS)
    return result


def _scene_packet_cache_key(payload: ScenePacketCreate) -> str:
    """按显式输入生成 Scene Packet 装配缓存键，避免同一请求重复编译上下文。"""

    fingerprint = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
    return f"storyforge:scene-packet:compile:{digest}"
