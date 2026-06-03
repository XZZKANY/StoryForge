from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TimelineEventCreate(BaseModel):
    """创建时间线事件时由调用方提交的业务事实。"""

    project_id: int = Field(gt=0)
    book_id: int = Field(gt=0)
    volume_id: int = Field(gt=0)
    chapter_id: int = Field(gt=0)
    time_order: int = Field(ge=0)
    summary: str = Field(min_length=1, max_length=50000)
    evidence_refs: list[str] = Field(default_factory=list, max_length=500)
    payload: dict[str, Any] = Field(default_factory=dict)


class TimelineEventRead(BaseModel):
    """时间线事件响应契约。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    book_id: int
    volume_id: int
    chapter_id: int
    time_order: int
    summary: str
    evidence_refs: list[str]
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime
