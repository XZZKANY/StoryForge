from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    seat_limit: int = Field(default=1, ge=1, le=1000)


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    slug: str
    status: str
    description: str | None
    seat_limit: int
    created_at: datetime
    updated_at: datetime


class WorkspaceMemberCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    role: str = Field(default="editor", min_length=1, max_length=50)
    status: str = Field(default="active", min_length=1, max_length=50)


class WorkspaceMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    display_name: str
    role: str
    status: str
    created_at: datetime
    updated_at: datetime
