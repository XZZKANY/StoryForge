from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.domains.judge.models import JudgeIssue


class JudgeIssueCreate(BaseModel):
    """结构化评审请求，正文与上下文约束都由调用方显式传入。"""

    scene_id: int = Field(gt=0)
    scene_packet_id: int | None = Field(default=None, gt=0)
    content: str = Field(min_length=1, max_length=50000)
    required_facts: list[str] = Field(default_factory=list, max_length=100)
    style_rules: list[str] = Field(default_factory=list, max_length=100)
    evidence_links: list[dict[str, Any]] = Field(default_factory=list, max_length=50)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "scene_id": 501,
                "scene_packet_id": 88,
                "content": "墨砚秋拔出佩剑霜河，剑芒在山门前划出一道弧。",
                "required_facts": ["主角剑名为霜河"],
                "style_rules": ["第三人称限知", "保持冷静叙述"],
                "evidence_links": [{"source_id": 17, "anchor": "ch-2#para-12"}],
            }
        }
    )


class JudgeIssueRead(BaseModel):
    """评审问题单响应契约，对外暴露结构化定位和修复建议。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    scene_id: int
    scene_packet_id: int | None
    category: str
    severity: str
    span_start: int
    span_end: int
    summary: str
    evidence_links: list[dict[str, Any]]
    recommended_repair_mode: str
    status: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_issue(cls, issue: JudgeIssue) -> JudgeIssueRead:
        """从数据库模型展开 payload 字段，避免泄漏内部存储结构。"""

        payload = issue.payload or {}
        return cls(
            id=issue.id,
            scene_id=issue.scene_id,
            scene_packet_id=issue.scene_packet_id,
            category=issue.issue_type,
            severity=issue.severity,
            span_start=int(payload.get("span_start", 0)),
            span_end=int(payload.get("span_end", 0)),
            summary=issue.description,
            evidence_links=list(payload.get("evidence_links", [])),
            recommended_repair_mode=str(payload.get("recommended_repair_mode", "replace_span")),
            status=issue.status,
            created_at=issue.created_at,
            updated_at=issue.updated_at,
        )
