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


class BookRunWorkflowChapter(BaseModel):
    """workflow dispatch 使用的章节映射，避免 worker 查询 API 数据库。"""

    chapter_index: int = Field(ge=1)
    chapter_id: int = Field(gt=0)
    chapter_goal: str = Field(min_length=1)


class BookRunWorkflowDispatch(BaseModel):
    """BookRun workflow worker 的稳定调度 payload。"""

    book_run_id: int = Field(gt=0)
    book_id: int = Field(gt=0)
    blueprint_id: int = Field(gt=0)
    total_chapters: int = Field(ge=1)
    start_chapter_index: int = Field(ge=1)
    existing_checkpoint: list[dict[str, Any]] = Field(default_factory=list)
    token_budget: int | None = Field(default=None, gt=0)
    time_budget_sec: int | None = Field(default=None, gt=0)
    chapter_budget: int | None = Field(default=None, gt=0)
    provider_fallback_pause_threshold: int | None = Field(default=None, gt=0)
    chapters: list[BookRunWorkflowChapter] = Field(default_factory=list)


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
