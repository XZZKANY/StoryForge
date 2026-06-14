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

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "workspace_id": 1,
                "book_id": 12,
                "artifact_type": "chapter_draft",
                "lineage_key": "book-12-ch-3",
                "name": "第三章 - 山门初见",
                "status": "active",
                "storage_uri": "s3://storyforge/drafts/book-12/ch-3.md",
                "mime_type": "text/markdown",
                "size_bytes": 8421,
                "payload": {"summary": "主角抵达山门，与守门弟子相遇。"},
            }
        }
    )


class ArtifactRead(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": 101,
                "workspace_id": 1,
                "book_id": 12,
                "artifact_type": "chapter_draft",
                "lineage_key": "book-12-ch-3",
                "name": "第三章 - 山门初见",
                "status": "active",
                "storage_uri": "s3://storyforge/drafts/book-12/ch-3.md",
                "mime_type": "text/markdown",
                "size_bytes": 8421,
                "payload": {"summary": "主角抵达山门。"},
                "version": 1,
                "created_at": "2026-05-26T08:00:00Z",
                "updated_at": "2026-05-26T08:00:00Z",
            }
        },
    )

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
    """制品下载摘要；download_mode 决定返回内联预览或 presigned URL。

    download_mode 取值：
    - "payload_preview": 无对象存储或 memory:// URI，返回 content_preview 与 payload_summary。
    - "presigned_url": S3 URI，返回 presigned_url 与 expires_at（5 分钟有效期）。
    """

    id: int
    artifact_type: str
    name: str
    mime_type: str
    storage_uri: str
    download_mode: str
    content_preview: str
    payload_summary: dict[str, Any]
    presigned_url: str | None = None
    expires_at: str | None = None  # ISO 8601


class ArtifactListPage(BaseModel):
    """制品列表的游标分页响应。"""

    items: list[ArtifactRead]
    next_cursor: str | None = None
    has_more: bool = False
