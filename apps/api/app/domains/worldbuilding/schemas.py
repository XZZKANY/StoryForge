from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class WorldbuildingSeriesRead(BaseModel):
    """世界观中心中的系列摘要。"""

    id: int
    title: str
    status: str
    description: str | None


class WorldbuildingItemRead(BaseModel):
    """世界观中心统一条目，保留来源和结构化载荷。"""

    id: int
    name: str
    type: str
    source: str
    payload: dict[str, Any]


class WorldbuildingMemoryRead(BaseModel):
    """来自系列级记忆的世界规则或跨书约束。"""

    id: int
    subject: str
    type: str
    source: str
    payload: dict[str, Any]


class WorldbuildingCenterRead(BaseModel):
    """完整世界观中心聚合响应。"""

    model_config = ConfigDict(from_attributes=True)

    series: WorldbuildingSeriesRead
    characters: list[WorldbuildingItemRead]
    locations: list[WorldbuildingItemRead]
    organizations: list[WorldbuildingItemRead]
    world_rules: list[WorldbuildingMemoryRead]
    unresolved_foreshadowing: list[WorldbuildingItemRead]
    cross_book_constraints: list[WorldbuildingMemoryRead]
    chapter_constraints: list[str]
