from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BatchRefineryItemCreate(BaseModel):
    """批量精修中的单个场景输入。"""

    scene_id: int = Field(gt=0)
    scene_packet_id: int | None = Field(default=None, gt=0)
    content: str = Field(min_length=1, max_length=50000)
    required_facts: list[str] = Field(default_factory=list, max_length=100)
    style_rules: list[str] = Field(default_factory=list, max_length=100)
    evidence_links: list[dict[str, Any]] = Field(default_factory=list, max_length=50)


class BatchRefineryRunCreate(BaseModel):
    """批量精修请求，当前阶段立即在本地同步执行。"""

    book_id: int = Field(gt=0)
    items: list[BatchRefineryItemCreate] = Field(min_length=1, max_length=100)


class BatchRefineryRunRead(BaseModel):
    """批量精修运行记录响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int | None
    status: str
    progress: dict[str, Any]
    error_message: str | None
    created_at: datetime
    updated_at: datetime
