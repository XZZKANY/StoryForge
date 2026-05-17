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

