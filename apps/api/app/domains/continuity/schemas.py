from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ChapterApprovalCreate(BaseModel):
    """章节批准时回写下一章需要继承的连续性事实。"""

    chapter_id: int = Field(gt=0)
    previous_chapter_summary: str = Field(min_length=1)
    character_state_changes: dict[str, Any] = Field(default_factory=dict)
    foreshadowing_changes: dict[str, Any] = Field(default_factory=dict)
    style_drift: str = Field(min_length=1)
    next_chapter_constraints: list[str] = Field(default_factory=list)


class ContinuityRecordRead(BaseModel):
    """连续性记录响应契约，保持数据库真相源可追溯。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int
    scene_id: int | None
    record_type: str
    subject: str
    status: str
    payload: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime


class ChapterApprovalRead(BaseModel):
    """章节批准响应包含本次写入的连续性记录集合。"""

    chapter_id: int
    book_id: int
    record_count: int
    records: list[ContinuityRecordRead]
