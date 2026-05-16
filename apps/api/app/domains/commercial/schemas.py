from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceSubscriptionCreate(BaseModel):
    plan_code: str = Field(min_length=1, max_length=80)
    status: str = Field(default="active", min_length=1, max_length=50)
    seat_limit: int = Field(ge=1, le=1000)
    monthly_job_limit: int = Field(default=0, ge=0)
    monthly_token_limit: int = Field(default=0, ge=0)
    monthly_price: float = Field(default=0, ge=0)


class WorkspaceSubscriptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    plan_code: str
    status: str
    seat_limit: int
    monthly_job_limit: int
    monthly_token_limit: int
    monthly_price: float
    created_at: datetime
    updated_at: datetime


class CommercialSummaryRead(BaseModel):
    workspace_id: int
    seat_limit: int
    active_member_count: int
    monthly_job_limit: int
    current_job_count: int
    monthly_token_limit: int
    current_token_estimate: int
    within_limits: bool
    status_summary: str
