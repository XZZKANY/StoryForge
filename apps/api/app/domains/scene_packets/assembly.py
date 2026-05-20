from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset, EvidenceLink
from app.domains.continuity.models import ContinuityRecord
from app.domains.scene_packets.schemas import EvidenceLinkRead, ScenePacketCreate


def load_active_assets(session: Session, payload: ScenePacketCreate) -> list[Asset]:
    """按请求顺序读取同一作品下的活跃资产。"""

    requested_ids = list(dict.fromkeys(payload.active_asset_ids))
    assets = session.scalars(
        select(Asset)
        .where(Asset.book_id == payload.book_id, Asset.id.in_(requested_ids), Asset.status == "active")
        .order_by(Asset.id)
    ).all()
    asset_by_id = {asset.id: asset for asset in assets}
    return [asset_by_id[asset_id] for asset_id in requested_ids if asset_id in asset_by_id]


def load_evidence_links(session: Session, scene_id: int, assets: list[Asset]) -> list[EvidenceLinkRead]:
    """优先读取证据表，缺失时生成资产来源回退链接。"""

    asset_ids = [asset.id for asset in assets]
    links = session.scalars(
        select(EvidenceLink)
        .where(
            EvidenceLink.asset_id.in_(asset_ids),
            or_(EvidenceLink.scene_id == scene_id, EvidenceLink.scene_id.is_(None)),
        )
        .order_by(EvidenceLink.id)
    ).all()

    evidence_links = [
        EvidenceLinkRead(
            asset_id=link.asset_id,
            evidence_type=link.evidence_type,
            source_ref=link.source_ref,
            rationale=link.rationale,
        )
        for link in links
    ]
    linked_asset_ids = {link.asset_id for link in evidence_links}
    evidence_links.extend(
        EvidenceLinkRead(
            asset_id=asset.id,
            evidence_type="asset_snapshot",
            source_ref=f"asset:{asset.id}",
            rationale=f"资产 {asset.name} 被显式加入本次 Scene Packet。",
        )
        for asset in assets
        if asset.id not in linked_asset_ids
    )
    return evidence_links


def filter_continuity_records_for_chapter(
    records: list[ContinuityRecord],
    chapter_id: int,
) -> list[ContinuityRecord]:
    """仅保留当前章节连续性，以及未绑定章节的全局连续性。"""

    return [record for record in records if record.payload.get("chapter_id") in (None, chapter_id)]
