from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PromptPackCreate(BaseModel):
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    pack_type: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="active", min_length=1, max_length=50)
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_scope(self) -> PromptPackCreate:
        if self.workspace_id is None and self.book_id is None:
            raise ValueError("Prompt Pack 至少需要 workspace_id 或 book_id 之一。")
        return self


class PromptPackUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, min_length=1, max_length=50)
    payload: dict[str, Any] | None = None

    @model_validator(mode="after")
    def require_changes(self) -> PromptPackUpdate:
        if not self.model_fields_set:
            raise ValueError("Prompt Pack 更新内容不能为空。")
        return self


class PromptPackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None
    book_id: int | None
    pack_type: str
    lineage_key: str
    name: str
    status: str
    payload: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime

