from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.domains.assets.schemas import AssetRead


class WorldbuildingEntryCreate(BaseModel):
    """创建世界观条目时提供的结构化内容。"""

    book_id: int = Field(gt=0)
    entry_type: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    payload: dict[str, Any] = Field(default_factory=dict)


class WorldbuildingEntryUpdate(BaseModel):
    """更新世界观条目会沿用资产谱系并创建新版本。"""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, min_length=1, max_length=50)
    payload: dict[str, Any] | None = None


WorldbuildingEntryRead = AssetRead
