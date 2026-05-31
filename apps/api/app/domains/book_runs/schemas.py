from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BookRunCreate(BaseModel):
    book_id: int = Field(gt=0)
    blueprint_id: int = Field(gt=0)
    token_budget: int | None = Field(default=None, gt=0)
    time_budget_sec: int | None = Field(default=None, gt=0)
    chapter_budget: int | None = Field(default=None, gt=0)


class BookRunProgressUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=50)
    current_chapter_index: int = Field(ge=1)
    progress: dict[str, Any] = Field(default_factory=dict)


class BookRunQualitySummary(BaseModel):
    overall_quality_score: int | float | None = None
    chapter_count: int = 0
    scored_chapter_count: int = 0
    issue_count: int = 0
    severe_issue_count: int = 0


class BookRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int
    blueprint_id: int
    status: str
    current_chapter_index: int
    total_chapters: int
    progress: dict[str, Any]
    checkpoint: list[dict[str, Any]]
    token_budget: int | None
    tokens_used: int
    time_budget_sec: int | None
    elapsed_time_sec: int
    chapter_budget: int | None
    estimated_cost: float
    cost_summary: dict[str, Any]
    quality_summary: BookRunQualitySummary | None = None
    created_at: datetime
    updated_at: datetime
