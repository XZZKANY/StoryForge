from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProviderConfigCreate(BaseModel):
    workspace_id: int | None = Field(default=None, gt=0)
    provider_name: str = Field(min_length=1, max_length=80)
    status: str = Field(default="active", min_length=1, max_length=50)
    priority: int = Field(default=100, ge=0, le=10000)
    capabilities: list[str] = Field(default_factory=list)
    model_aliases: dict[str, Any] = Field(default_factory=dict)
    credential_ref: str | None = Field(default=None, max_length=255)


class ProviderConfigRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None
    provider_name: str
    status: str
    priority: int
    capabilities: list[str]
    model_aliases: dict[str, Any]
    credential_ref: str | None
    created_at: datetime
    updated_at: datetime


class ProviderResolutionRead(BaseModel):
    provider_id: int
    provider_name: str
    capability: str
    model_aliases: dict[str, Any]
    resolution_summary: str
