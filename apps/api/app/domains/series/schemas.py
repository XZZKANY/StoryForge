from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SeriesCreate(BaseModel):
    """创建系列时提供的根信息。"""

    title: str = Field(min_length=1, max_length=255)
    premise: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class SeriesRead(BaseModel):
    """系列响应契约，附带当前记忆快照数量。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: str
    premise: str | None
    payload: dict[str, Any]
    versioned_memory_count: int = 0
    created_at: datetime
    updated_at: datetime


class SeriesBookAttach(BaseModel):
    """把作品加入系列时的顺序和继承策略。"""

    book_id: int = Field(gt=0)
    ordinal: int = Field(gt=0)
    inheritance_policy: str = Field(default="inherit_active", min_length=1, max_length=80)
    payload: dict[str, Any] = Field(default_factory=dict)


class SeriesBookRead(BaseModel):
    """系列作品关联响应契约。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    series_id: int
    book_id: int
    ordinal: int
    inheritance_policy: str
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class SeriesMemorySnapshotCreate(BaseModel):
    """创建系列级记忆快照，快照来源仍需追溯到结构化事实。"""

    series_id: int = Field(gt=0)
    book_id: int | None = Field(default=None, gt=0)
    source_continuity_record_id: int | None = Field(default=None, gt=0)
    snapshot_type: str = Field(min_length=1, max_length=80)
    subject: str = Field(min_length=1, max_length=255)
    payload: dict[str, Any] = Field(default_factory=dict)


class SeriesMemorySnapshotRead(BaseModel):
    """系列记忆快照响应契约。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    series_id: int
    book_id: int | None
    source_continuity_record_id: int | None
    job_run_id: int | None
    snapshot_type: str
    subject: str
    status: str
    payload: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime


class SeriesSummaryBook(BaseModel):
    """系列记忆摘要中的作品条目。"""

    book_id: int
    ordinal: int
    inheritance_policy: str


class SeriesMemorySummaryRead(BaseModel):
    """系列记忆摘要聚合系列、作品、记忆快照和世界观条目。"""

    series: SeriesRead
    books: list[SeriesSummaryBook]
    latest_memory_snapshots: list[SeriesMemorySnapshotRead]
    worldbuilding_entries: list[dict[str, Any]]
