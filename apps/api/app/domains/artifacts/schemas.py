from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ArtifactCreate(BaseModel):
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    artifact_type: str = Field(min_length=1, max_length=80)
    lineage_key: str | None = Field(default=None, min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="active", min_length=1, max_length=50)
    storage_uri: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=120)
    size_bytes: int = Field(default=0, ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)


class ArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None
    book_id: int | None
    artifact_type: str
    lineage_key: str
    name: str
    status: str
    storage_uri: str
    mime_type: str
    size_bytes: int
    payload: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime


class ArtifactDownloadRead(BaseModel):
    """制品下载摘要在没有对象存储签名时返回可审查内容。"""

    id: int
    artifact_type: str
    name: str
    mime_type: str
    storage_uri: str
    download_mode: str
    content_preview: str
    payload_summary: dict[str, Any]

