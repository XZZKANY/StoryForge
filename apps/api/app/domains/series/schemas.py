from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SeriesCreate(BaseModel):
    """创建系列根实体的输入契约。"""

    title: str = Field(min_length=1, max_length=255)
    status: str = Field(default="active", min_length=1, max_length=50)
    description: str | None = None


class SeriesRead(BaseModel):
    """系列根实体响应契约。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class SeriesMemoryEvidenceCreate(BaseModel):
    """创建系列记忆时附带的来源证据。"""

    evidence_type: str = Field(min_length=1, max_length=80)
    source_ref: str = Field(min_length=1, max_length=255)
    rationale: str | None = None


class SeriesMemoryEvidenceRead(BaseModel):
    """系列记忆证据响应契约。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    evidence_type: str
    source_ref: str
    rationale: str | None


class SeriesMemoryCreate(BaseModel):
    """创建系列记忆首版本的输入契约。"""

    memory_type: str = Field(min_length=1, max_length=80)
    subject: str = Field(min_length=1, max_length=255)
    status: str = Field(default="active", min_length=1, max_length=50)
    payload: dict[str, Any] = Field(default_factory=dict)
    evidence: list[SeriesMemoryEvidenceCreate] = Field(default_factory=list)


class SeriesMemoryUpdate(BaseModel):
    """更新系列记忆会产生新版本，未提供字段沿用上一版本。"""

    memory_type: str | None = Field(default=None, min_length=1, max_length=80)
    subject: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, min_length=1, max_length=50)
    payload: dict[str, Any] | None = None
    evidence: list[SeriesMemoryEvidenceCreate] | None = None

    @model_validator(mode="after")
    def reject_empty_update(self) -> "SeriesMemoryUpdate":
        """空更新无法形成有意义的系列记忆版本。"""

        if not self.model_fields_set:
            raise ValueError("系列记忆更新内容不能为空。")
        return self


class SeriesMemoryRead(BaseModel):
    """系列记忆响应契约，包含证据与版本号。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    series_id: int
    memory_type: str
    lineage_key: str
    subject: str
    status: str
    payload: dict[str, Any]
    version: int
    evidence: list[SeriesMemoryEvidenceRead]
    created_at: datetime
    updated_at: datetime
