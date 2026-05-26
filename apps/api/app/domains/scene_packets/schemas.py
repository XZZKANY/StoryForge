from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ScenePacketCreate(BaseModel):
    """组装场景上下文包所需的显式输入。"""

    book_id: int = Field(gt=0)
    chapter_id: int = Field(gt=0)
    scene_goal: str = Field(min_length=1, max_length=5000)
    active_asset_ids: list[int] = Field(min_length=1, max_length=1000)
    token_budget: int = Field(gt=0)
    user_intent: str = Field(default="", max_length=2000)
    retrieval_snippets: list[str] = Field(default_factory=list, max_length=100)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "book_id": 12,
                "chapter_id": 33,
                "scene_goal": "主角抵达山门，与守门弟子发生冲突，揭示佩剑霜河的身份。",
                "active_asset_ids": [305, 308, 412],
                "token_budget": 8000,
                "user_intent": "需要强调主角剑名'霜河'与上一章伏笔呼应",
                "retrieval_snippets": ["守门弟子规矩见第二章 para-12"],
            }
        }
    )


class EvidenceLinkRead(BaseModel):
    """证据链接响应用于追溯上下文来源。"""

    asset_id: int
    evidence_type: str
    source_ref: str
    rationale: str | None = None
    score: float | None = None
    rank: int | None = None
    source_id: int | None = None
    chunk_id: int | None = None
    score_source: str | None = None
    keyword_score: float | None = None
    embedding_score: float | None = None
    rerank_score: float | None = None
    rerank_provider: str | None = None
    rerank_model: str | None = None
    context_tokens: int | None = None


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
