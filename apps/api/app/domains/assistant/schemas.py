from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AssistantMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1, max_length=12000)


class AssistantMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    role: str
    content: str
    created_at: datetime
    updated_at: datetime


class AssistantSessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=160)
    task_type: str = Field(min_length=1, max_length=50)
    blueprint_id: int | None = Field(default=None, gt=0)
    book_run_id: int | None = Field(default=None, gt=0)
    artifact_id: int | None = Field(default=None, gt=0)
    messages: list[AssistantMessageCreate] = Field(default_factory=list, max_length=50)


class AssistantSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    task_type: str
    blueprint_id: int | None
    book_run_id: int | None
    artifact_id: int | None
    messages: list[AssistantMessageRead]
    created_at: datetime
    updated_at: datetime


class AssistantToolCallCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_name: str = Field(min_length=1, max_length=120)
    status: str = Field(pattern="^(planned|running|completed|failed|needs_approval|paused)$")
    input_summary: dict[str, Any] = Field(default_factory=dict)
    output_summary: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = Field(default=None, max_length=4000)
    related_type: str | None = Field(default=None, max_length=80)
    related_id: int | None = Field(default=None, gt=0)
    started_at: datetime | None = None
    finished_at: datetime | None = None


class AssistantToolCallUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str | None = Field(
        default=None,
        pattern="^(planned|running|completed|failed|needs_approval|paused)$",
    )
    input_summary: dict[str, Any] | None = None
    output_summary: dict[str, Any] | None = None
    error_message: str | None = Field(default=None, max_length=4000)
    related_type: str | None = Field(default=None, max_length=80)
    related_id: int | None = Field(default=None, gt=0)
    started_at: datetime | None = None
    finished_at: datetime | None = None


class AssistantToolCallRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    tool_name: str
    status: str
    input_summary: dict[str, Any]
    output_summary: dict[str, Any]
    error_message: str | None
    related_type: str | None
    related_id: int | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime
