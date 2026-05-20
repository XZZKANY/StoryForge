from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ModelRunCreate(BaseModel):
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    scene_id: int | None = Field(default=None, gt=0)
    job_run_id: int | None = Field(default=None, gt=0)
    prompt_pack_id: int | None = Field(default=None, gt=0)
    provider_name: str = Field(min_length=1, max_length=80)
    model_name: str = Field(min_length=1, max_length=120)
    capability: str = Field(min_length=1, max_length=80)
    status: str = Field(default="completed", min_length=1, max_length=50)
    latency_ms: int = Field(default=0, ge=0)
    token_usage: int = Field(default=0, ge=0)
    input_summary: str = Field(min_length=1)
    output_summary: str | None = None
    error_message: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class ModelRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None
    book_id: int | None
    scene_id: int | None
    job_run_id: int | None
    prompt_pack_id: int | None
    provider_name: str
    model_name: str
    capability: str
    status: str
    latency_ms: int
    token_usage: int
    input_summary: str
    output_summary: str | None
    error_message: str | None
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class RunsModelRunSummary(BaseModel):
    id: int
    provider_name: str
    model_name: str
    capability: str
    status: str
    latency_ms: int
    token_usage: int
    error_message: str | None


class RunsJobRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_type: str
    status: str
    progress: dict[str, Any]
    checkpoint: dict[str, Any] | None
    model_runs: list[RunsModelRunSummary]
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class RunsJobRunRetryRead(BaseModel):
    """Runs 失败重试执行结果，只创建恢复任务并返回入口状态。"""

    can_retry: bool
    retry_job_run_id: int | None
    source_job_run_id: int
    recovery_node: str | None
    checkpoint: dict[str, Any] | None
    retry_status: str
    unavailable_reason: str | None

