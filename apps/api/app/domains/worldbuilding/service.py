from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.continuity.models import ContinuityRecord
from app.domains.series.models import Series, SeriesMemory
from app.domains.worldbuilding.schemas import (
    WorldbuildingCenterRead,
    WorldbuildingItemRead,
    WorldbuildingMemoryRead,
    WorldbuildingSeriesRead,
)


class WorldbuildingNotFoundError(ValueError):
    """世界观中心无法定位系列时抛出。"""


def build_worldbuilding_center(session: Session, series_id: int, book_id: int | None = None) -> WorldbuildingCenterRead:
    """聚合系列记忆、作品资产和连续性记录，形成只读世界观中心。"""

    series = session.get(Series, series_id)
    if series is None:
        raise WorldbuildingNotFoundError("系列不存在，无法构建世界观中心。")
    assets = _load_assets(session, book_id)
    memories = session.scalars(
        select(SeriesMemory)
        .where(SeriesMemory.series_id == series_id, SeriesMemory.status == "active")
        .order_by(SeriesMemory.id)
    ).all()
    continuity_records = _load_continuity_records(session, book_id)
    return WorldbuildingCenterRead(
        series=WorldbuildingSeriesRead(
            id=series.id,
            title=series.title,
            status=series.status,
            description=series.description,
        ),
        characters=_asset_items(assets, "character"),
        locations=_asset_items(assets, "location"),
        organizations=_asset_items(assets, "organization"),
        world_rules=_memory_items(memories, "world_rule"),
        unresolved_foreshadowing=[
            item for item in _asset_items(assets, "foreshadowing") if item.payload.get("状态") != "已回收"
        ],
        cross_book_constraints=_memory_items(memories, "cross_book_constraint"),
        chapter_constraints=_chapter_constraints(continuity_records),
    )


def _load_assets(session: Session, book_id: int | None) -> list[Asset]:
    """按作品范围读取资产，保持稳定排序。"""

    statement = select(Asset).where(Asset.status == "active").order_by(Asset.id)
    if book_id is not None:
        statement = statement.where(Asset.book_id == book_id)
    return list(session.scalars(statement).all())


def _load_continuity_records(session: Session, book_id: int | None) -> list[ContinuityRecord]:
    """读取作品连续性记录，空作品范围时返回空列表避免无界聚合。"""

    if book_id is None:
        return []
    return list(
        session.scalars(
            select(ContinuityRecord)
            .where(ContinuityRecord.book_id == book_id, ContinuityRecord.status == "active")
            .order_by(ContinuityRecord.id)
        ).all()
    )


def _asset_items(assets: list[Asset], asset_type: str) -> list[WorldbuildingItemRead]:
    """把指定类型资产转为世界观中心条目。"""

    return [
        WorldbuildingItemRead(id=asset.id, name=asset.name, type=asset.asset_type, source="asset", payload=asset.payload)
        for asset in assets
        if asset.asset_type == asset_type
    ]


def _memory_items(memories: list[SeriesMemory], memory_type: str) -> list[WorldbuildingMemoryRead]:
    """把指定类型系列记忆转为世界观中心条目。"""

    return [
        WorldbuildingMemoryRead(id=memory.id, subject=memory.subject, type=memory.memory_type, source="series_memory", payload=memory.payload)
        for memory in memories
        if memory.memory_type == memory_type
    ]


def _chapter_constraints(records: list[ContinuityRecord]) -> list[str]:
    """收集章节连续性里的下一章继承约束。"""

    values: list[str] = []
    for record in records:
        if record.record_type != "next_chapter_constraints":
            continue
        raw_value: Any = record.payload.get("value")
        if isinstance(raw_value, list):
            values.extend(str(item) for item in raw_value)
        elif raw_value is not None:
            values.append(str(raw_value))
    return values
