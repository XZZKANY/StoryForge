from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EvaluationCaseCreate(BaseModel):
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    case_name: str = Field(min_length=1, max_length=255)
    case_type: str = Field(min_length=1, max_length=80)
    input_payload: dict[str, Any] = Field(default_factory=dict)
    expected_payload: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "workspace_id": 1,
                "book_id": 12,
                "case_name": "连续性 - 主角剑名一致性",
                "case_type": "continuity",
                "input_payload": {"chapter_id": 33},
                "expected_payload": {"sword_name": "霜河"},
            }
        }
    )


class EvaluationCaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None
    book_id: int | None
    case_name: str
    case_type: str
    status: str
    input_payload: dict[str, Any]
    expected_payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class EvaluationRunCreate(BaseModel):
    case_id: int | None = Field(default=None, gt=0)
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    observed_payload: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "case_id": 42,
                "workspace_id": 1,
                "book_id": 12,
                "observed_payload": {"sword_name": "霜河", "matched": True},
            }
        }
    )


class EvaluationRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    case_id: int | None
    workspace_id: int | None
    book_id: int | None
    status: str
    metrics: dict[str, Any]
    summary: str
    created_at: datetime
    updated_at: datetime


class EvaluationRunListPage(BaseModel):
    """评测运行的游标分页响应。"""

    items: list[EvaluationRunRead]
    next_cursor: str | None = None
    has_more: bool = False


class EvaluationFailedSampleRead(BaseModel):
    """评测失败样例用于把质量问题追溯回章节、制品和 Studio 修复入口。"""

    id: str
    reason: str
    chapter_id: int | None = None
    artifact_id: int | None = None
    repair_hint: str
    studio_href: str | None = None


class EvaluationRunDetailRead(BaseModel):
    """评测运行详情包含趋势摘要和失败样例数量。"""

    run: EvaluationRunRead
    trend_points: list[dict[str, Any]]
    failed_sample_count: int
    studio_feedback_href: str | None
