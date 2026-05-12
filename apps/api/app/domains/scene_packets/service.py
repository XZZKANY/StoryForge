from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset, EvidenceLink
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.scene_packets.schemas import (
    BudgetStatistics,
    EvidenceLinkRead,
    ScenePacketCreate,
    ScenePacketRead,
)


class ScenePacketInputError(ValueError):
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
    packet, budget_statistics = _build_packet(payload, chapter, assets, continuity_records, evidence_links)

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


def _load_active_assets(session: Session, payload: ScenePacketCreate) -> list[Asset]:
    """按请求顺序读取同一作品下的活跃资产。"""
    requested_ids = list(dict.fromkeys(payload.active_asset_ids))
    assets = session.scalars(
        select(Asset)
        .where(Asset.book_id == payload.book_id, Asset.id.in_(requested_ids), Asset.status == "active")
        .order_by(Asset.id)
    ).all()
    asset_by_id = {asset.id: asset for asset in assets}
    return [asset_by_id[asset_id] for asset_id in requested_ids if asset_id in asset_by_id]


def _load_evidence_links(session: Session, scene_id: int, assets: list[Asset]) -> list[EvidenceLinkRead]:
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


def _filter_continuity_records_for_chapter(
    records: list[ContinuityRecord],
    chapter_id: int,
) -> list[ContinuityRecord]:
    """仅保留当前章节连续性，以及未绑定章节的全局连续性。"""

    return [
        record
        for record in records
        if record.payload.get("chapter_id") in (None, chapter_id)
    ]


def _build_packet(
    payload: ScenePacketCreate,
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
    evidence_links: list[EvidenceLinkRead],
) -> tuple[dict[str, Any], BudgetStatistics]:
    """按优先级构造固定槽位，并控制检索片段的预算占用。"""

    characters = [_asset_summary(asset) for asset in assets if asset.asset_type == "character"]
    foreshadowing = [_asset_summary(asset) for asset in assets if asset.asset_type == "foreshadowing"]
    style_rules = [_style_rule(asset) for asset in assets if asset.asset_type == "style_rule"]
    include_facts = _collect_payload_values(assets, "必须包含事实") + _continuity_constraints(continuity_records)
    avoid_facts = _collect_payload_values(assets, "必须规避事实")
    packet: dict[str, Any] = {
        "章节目标": payload.scene_goal,
        "活跃角色": characters,
        "关系状态": _relationship_states(assets),
        "未回收伏笔": foreshadowing,
        "风格规则": style_rules,
        "必须包含事实": include_facts,
        "必须规避事实": avoid_facts,
        "用户意图": payload.user_intent,
        "证据链接": [link.model_dump() for link in evidence_links],
        "上一章摘要": _continuity_values(continuity_records, "previous_chapter_summary"),
        "章节摘要": chapter.summary,
    }
    reserved_tokens = _estimate_tokens(packet)
    snippets, retrieval_tokens, truncated = _fit_retrieval_snippets(
        payload.retrieval_snippets,
        payload.token_budget,
        reserved_tokens,
    )
    packet["检索片段"] = snippets
    used_tokens = reserved_tokens + retrieval_tokens
    statistics = BudgetStatistics(
        token_budget=payload.token_budget,
        used_tokens=used_tokens,
        reserved_tokens=reserved_tokens,
        retrieval_tokens=retrieval_tokens,
        truncated=truncated or used_tokens > payload.token_budget,
    )
    return packet, statistics


def _asset_summary(asset: Asset) -> dict[str, Any]:
    """输出资产摘要，保留类型、名称和结构化载荷。"""

    return {"id": asset.id, "type": asset.asset_type, "name": asset.name, "payload": asset.payload}


def _style_rule(asset: Asset) -> dict[str, Any]:
    """风格规则槽位优先展示规则文本，同时保留来源资产。"""

    return {"id": asset.id, "name": asset.name, "rule": asset.payload.get("规则", asset.payload)}


def _relationship_states(assets: list[Asset]) -> list[dict[str, Any]]:
    """从角色资产载荷中提取关系状态。"""

    return [
        {"asset_id": asset.id, "name": asset.name, "state": asset.payload["关系"]}
        for asset in assets
        if asset.asset_type == "character" and "关系" in asset.payload
    ]


def _collect_payload_values(assets: list[Asset], key: str) -> list[Any]:
    """从资产载荷收集硬约束列表，保持输入顺序。"""

    values: list[Any] = []
    for asset in assets:
        raw_value = asset.payload.get(key)
        if isinstance(raw_value, list):
            values.extend(raw_value)
        elif raw_value is not None:
            values.append(raw_value)
    return values


def _continuity_values(records: list[ContinuityRecord], record_type: str) -> list[Any]:
    """读取指定类型的连续性载荷。"""

    return [record.payload.get("value") for record in records if record.record_type == record_type]


def _continuity_constraints(records: list[ContinuityRecord]) -> list[Any]:
    """下一章继承约束属于硬约束，预算不足时也必须保留。"""

    values: list[Any] = []
    for raw_value in _continuity_values(records, "next_chapter_constraints"):
        if isinstance(raw_value, list):
            values.extend(raw_value)
        elif raw_value is not None:
            values.append(raw_value)
    return values


def _fit_retrieval_snippets(
    snippets: list[str],
    token_budget: int,
    reserved_tokens: int,
) -> tuple[list[str], int, bool]:
    """只在剩余预算允许时加入检索片段，避免覆盖硬约束。"""

    remaining = max(token_budget - reserved_tokens, 0)
    selected: list[str] = []
    used = 0
    truncated = False
    for snippet in snippets:
        snippet_tokens = _estimate_tokens(snippet)
        if used + snippet_tokens <= remaining:
            selected.append(snippet)
            used += snippet_tokens
        else:
            truncated = True
    return selected, used, truncated


def _estimate_tokens(value: Any) -> int:
    """用轻量字符近似估算预算，避免引入额外分词依赖。"""

    text = str(value)
    return max(1, (len(text) + 5) // 6)
