from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EventRecordCreate(BaseModel):
    workspace_id: int = Field(gt=0)
    event_type: str = Field(min_length=1, max_length=80)
    source: str = Field(min_length=1, max_length=80)
    payload: dict[str, Any] = Field(default_factory=dict)
    book_id: int | None = Field(default=None, gt=0)
    scene_id: int | None = Field(default=None, gt=0)
    member_id: int | None = Field(default=None, gt=0)


class EventLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    book_id: int | None
    scene_id: int | None
    member_id: int | None
    event_type: str
    source: str
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime
