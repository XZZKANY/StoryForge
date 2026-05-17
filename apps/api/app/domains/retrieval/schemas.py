from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RetrievalSourceCreate(BaseModel):
    book_id: int | None = Field(default=None, gt=0)
    series_id: int | None = Field(default=None, gt=0)
    source_type: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    content_text: str = Field(min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_scope(self) -> "RetrievalSourceCreate":
        if self.book_id is None and self.series_id is None:
            raise ValueError("资料源至少需要 book_id 或 series_id 之一。")
        return self


class RetrievalSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int | None
    series_id: int | None
    source_type: str
    title: str
    status: str
    content_text: str
    payload: dict[str, Any]
    chunk_count: int
    created_at: datetime
    updated_at: datetime


class RetrievalRefreshRunCreate(BaseModel):
    source_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    series_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def require_scope(self) -> "RetrievalRefreshRunCreate":
        if self.source_id is None and self.book_id is None and self.series_id is None:
            raise ValueError("刷新任务至少需要 source_id、book_id 或 series_id 之一。")
        return self


class RetrievalRefreshRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_id: int | None
    book_id: int | None
    series_id: int | None
    status: str
    chunk_count: int
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class RetrievalSearchCreate(BaseModel):
    query: str = Field(min_length=1)
    book_id: int | None = Field(default=None, gt=0)
    series_id: int | None = Field(default=None, gt=0)
    limit: int = Field(default=5, ge=1, le=20)

    @model_validator(mode="after")
    def require_scope(self) -> "RetrievalSearchCreate":
        if self.book_id is None and self.series_id is None:
            raise ValueError("检索查询至少需要 book_id 或 series_id 之一。")
        return self


class RetrievalHitRead(BaseModel):
    source_id: int
    chunk_id: int
    source_ref: str
    book_id: int | None
    series_id: int | None
    title: str
    excerpt: str
    score: float
    rank: int
