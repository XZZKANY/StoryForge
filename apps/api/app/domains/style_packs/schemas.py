from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StylePackCreate(BaseModel):
    """创建风格包首版本。"""

    book_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="active", min_length=1, max_length=50)
    payload: dict[str, Any] = Field(default_factory=dict)


class StylePackUpdate(BaseModel):
    """更新风格包会产生新版本。"""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, min_length=1, max_length=50)
    payload: dict[str, Any] | None = None

    @model_validator(mode="after")
    def reject_empty_update(self) -> "StylePackUpdate":
        if not self.model_fields_set:
            raise ValueError("风格包更新内容不能为空。")
        return self


class StylePackApplyCreate(BaseModel):
    """把风格包应用到作品，生成 style_rule 资产。"""

    book_id: int = Field(gt=0)
    scene_id: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str = Field(default="active", min_length=1, max_length=50)


class StylePackRead(BaseModel):
    """风格包响应契约。"""

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


class StyleRuleRead(BaseModel):
    """应用风格包后生成的作品级风格规则资产。"""

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
