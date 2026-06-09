from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ContinuityEdgeInput(BaseModel):
    """批准时随章节显式提交的结构化连续性边（关系/时间线/状态）。"""

    edge_kind: Literal["relationship", "timeline_order", "status"]
    subject_ref: str = Field(min_length=1, max_length=160)
    predicate: str = Field(min_length=1, max_length=80)
    object_ref: str = Field(min_length=1, max_length=160)
    valid_from_chapter: int = Field(default=1, ge=1)
    valid_to_chapter: int | None = Field(default=None, ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)


class ChapterApprovalCreate(BaseModel):
    """章节批准时回写下一章需要继承的连续性事实。"""

    chapter_id: int = Field(gt=0)
    previous_chapter_summary: str = Field(min_length=1, max_length=50000)
    character_state_changes: dict[str, Any] = Field(default_factory=dict)
    foreshadowing_changes: dict[str, Any] = Field(default_factory=dict)
    style_drift: str = Field(min_length=1, max_length=5000)
    next_chapter_constraints: list[str] = Field(default_factory=list, max_length=100)
    continuity_edges: list[ContinuityEdgeInput] = Field(default_factory=list, max_length=200)


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
    continuity_edge_count: int = 0
