from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AssetCreate(BaseModel):
    """创建资产时由调用方提供的业务载荷。"""

    book_id: int = Field(gt=0)
    scene_id: int | None = Field(default=None, gt=0)
    asset_type: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="active", min_length=1, max_length=50)
    payload: dict[str, Any] = Field(default_factory=dict)


class AssetUpdate(BaseModel):
    """更新资产会产生新版本，未提供字段沿用上一版本。"""

    scene_id: int | None = Field(default=None, gt=0)
    asset_type: str | None = Field(default=None, min_length=1, max_length=80)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, min_length=1, max_length=50)
    payload: dict[str, Any] | None = None

    @model_validator(mode="after")
    def reject_required_field_nulls(self) -> "AssetUpdate":
        """显式清空核心字段会破坏版本契约，必须在入库前拒绝。"""

        null_fields = [
            field_name
            for field_name in ("asset_type", "name", "status", "payload")
            if field_name in self.model_fields_set and getattr(self, field_name) is None
        ]
        if null_fields:
            fields = "、".join(null_fields)
            raise ValueError(f"字段 {fields} 不允许显式传入 null。")
        return self


class AssetRead(BaseModel):
    """资产响应契约，所有路由响应都通过该结构输出。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int
    scene_id: int | None
    asset_type: str
    lineage_key: str
    name: str
    status: str
    payload: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime
