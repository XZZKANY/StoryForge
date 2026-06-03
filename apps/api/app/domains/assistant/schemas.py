from __future__ import annotations

from datetime import datetime

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
