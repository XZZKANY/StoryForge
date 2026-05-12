from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ScenePacketCreate(BaseModel):
    """组装场景上下文包所需的显式输入。"""

    book_id: int = Field(gt=0)
    chapter_id: int = Field(gt=0)
    scene_goal: str = Field(min_length=1)
    active_asset_ids: list[int] = Field(min_length=1)
    token_budget: int = Field(gt=0)
    user_intent: str = Field(default="", max_length=2000)
    retrieval_snippets: list[str] = Field(default_factory=list)


class EvidenceLinkRead(BaseModel):
    """证据链接响应用于追溯上下文来源。"""

    asset_id: int
    evidence_type: str
    source_ref: str
    rationale: str | None = None


class BudgetStatistics(BaseModel):
    """预算统计说明上下文包是否发生检索片段裁剪。"""

    token_budget: int
    used_tokens: int
    reserved_tokens: int
    retrieval_tokens: int
    truncated: bool


class ScenePacketRead(BaseModel):
    """Scene Packet 响应契约，固定槽位保存在 packet 字段中。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    scene_id: int
    status: str
    packet: dict[str, Any]
    budget_statistics: BudgetStatistics
    evidence_links: list[EvidenceLinkRead]
    version: int
    created_at: datetime
    updated_at: datetime
