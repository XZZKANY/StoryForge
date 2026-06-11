from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MANUAL_READ_DIMENSIONS = frozenset(
    {
        "narrative_quality",
        "character_consistency",
        "world_consistency",
        "timeline_consistency",
        "style_consistency",
        "system_reliability",
    }
)


class BookRunCreate(BaseModel):
    book_id: int = Field(gt=0)
    blueprint_id: int = Field(gt=0)
    token_budget: int | None = Field(default=None, gt=0)
    time_budget_sec: int | None = Field(default=None, gt=0)
    chapter_budget: int | None = Field(default=None, gt=0)


class BookRunControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=200)


class BookRunChapterRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: int = Field(ge=1)
    end: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_order(self):
        if self.start > self.end:
            raise ValueError("章节范围起点不能大于终点。")
        return self


class BookRunVolumePlanItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    volume_index: int = Field(ge=1)
    chapter_range: BookRunChapterRange


class BookRunVolumeProgress(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_volume: int = Field(ge=1)
    chapter_range: BookRunChapterRange
    completed_chapter_count: int = Field(ge=0)
    next_batch_start_chapter_index: int = Field(ge=1)


class ManualReadDimensionScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: str = Field(min_length=1, max_length=80)
    score: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_dimension(self):
        if self.dimension not in MANUAL_READ_DIMENSIONS:
            allowed = "、".join(sorted(MANUAL_READ_DIMENSIONS))
            raise ValueError(f"盲评维度 {self.dimension} 不在允许集合内：{allowed}")
        return self


class ManualReadReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["passed", "failed", "needs_revision"]
    reviewer: str = Field(min_length=1, max_length=120)
    reviewed_chapter_count: int = Field(ge=0)
    word_count: int = Field(ge=0)
    dimension_scores: list[ManualReadDimensionScore] = Field(min_length=1)
    overall_score: float | None = Field(default=None, ge=1, le=5)
    conclusion: str = Field(min_length=1, max_length=2000)
    blind: bool = False

    @model_validator(mode="after")
    def validate_review(self):
        seen: set[str] = set()
        for item in self.dimension_scores:
            if item.dimension in seen:
                raise ValueError(f"盲评维度 {item.dimension} 重复评分。")
            seen.add(item.dimension)
        if self.overall_score is None:
            mean = sum(item.score for item in self.dimension_scores) / len(self.dimension_scores)
            self.overall_score = round(mean, 2)
        return self


class BookRunProgressUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=50)
    current_chapter_index: int = Field(ge=1)
    progress: dict[str, Any] = Field(default_factory=dict)
    volume_progress: BookRunVolumeProgress | None = None
    manual_read_review: ManualReadReview | None = None


class BookRunWorkflowPlanningRefs(BaseModel):
    """workflow 只需要轻量规划引用，不接收完整规划对象。"""

    arc_ids: list[str] = Field(default_factory=list)
    arc_completion_ratio: float = Field(ge=0, le=1)


class BookRunWorkflowChapter(BaseModel):
    """workflow dispatch 使用的章节映射，避免 worker 查询 API 数据库。"""

    chapter_index: int = Field(ge=1)
    chapter_id: int = Field(gt=0)
    chapter_goal: str = Field(min_length=1)
    planning_refs: BookRunWorkflowPlanningRefs | None = None


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
    volume_plan: list[BookRunVolumePlanItem] = Field(default_factory=list)


class BookRunQualitySummary(BaseModel):
    overall_quality_score: int | float | None = None
    chapter_count: int = 0
    scored_chapter_count: int = 0
    issue_count: int = 0
    severe_issue_count: int = 0


class BookRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None = None
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
    total_latency_ms: int
    max_latency_ms: int
    avg_latency_ms: int
    chapter_budget: int | None
    estimated_cost: float
    cost_summary: dict[str, Any]
    quality_summary: BookRunQualitySummary | None = None
    created_at: datetime
    updated_at: datetime
