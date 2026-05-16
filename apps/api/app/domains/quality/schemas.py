from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class QualityDashboardQuery(BaseModel):
    """质量看板查询范围。"""

    book_id: int | None = Field(default=None, gt=0)
    series_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def require_scope(self) -> "QualityDashboardQuery":
        if self.book_id is None and self.series_id is None:
            raise ValueError("质量看板至少需要 book_id 或 series_id 之一。")
        return self


class QualityDashboardRead(BaseModel):
    """质量看板聚合响应。"""

    book_id: int | None
    series_id: int | None
    open_issue_count: int
    repair_acceptance_rate: float
    job_success_rate: float
    series_memory_count: int
    open_issue_summary: str
    repair_acceptance_summary: str
    job_success_summary: str
    series_memory_summary: str
