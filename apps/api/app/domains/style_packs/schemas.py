from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domains.assets.schemas import AssetRead


class StylePackCreate(BaseModel):
    """创建可复用风格包。"""

    book_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=255)
    payload: dict[str, Any] = Field(default_factory=dict)


class StylePackUpdate(BaseModel):
    """更新风格包会创建新资产版本。"""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, min_length=1, max_length=50)
    payload: dict[str, Any] | None = None


StylePackRead = AssetRead


class StylePackApplyCreate(BaseModel):
    """把风格包应用到系列、作品或场景。"""

    style_pack_asset_id: int = Field(gt=0)
    series_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    scene_id: int | None = Field(default=None, gt=0)
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_scope(self) -> "StylePackApplyCreate":
        """风格包应用必须至少指定一个生效范围。"""

        if self.series_id is None and self.book_id is None and self.scene_id is None:
            raise ValueError("至少选择一个应用范围。")
        return self


class StylePackApplicationRead(BaseModel):
    """风格包应用响应契约。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    style_pack_asset_id: int
    series_id: int | None
    book_id: int | None
    scene_id: int | None
    status: str
    payload: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime


class EffectiveStyleRulesRead(BaseModel):
    """合并后的风格规则响应。"""

    book_id: int
    scene_id: int | None
    style_pack_asset_ids: list[int]
    rules: list[str]
    voice: str | None = None
    banned_phrases: list[str] = Field(default_factory=list)
    preferred_patterns: list[str] = Field(default_factory=list)
