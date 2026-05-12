from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.domains.judge.models import RepairPatch


class RepairPatchCreate(BaseModel):
    """请求定向修复某一条评审问题单。"""

    issue_id: int = Field(gt=0)
    content: str = Field(min_length=1)


class RepairPatchRead(BaseModel):
    """定向修复响应只描述命中片段及替换文本，不返回整章正文。"""

    id: int
    issue_id: int
    target_span: str
    replacement_text: str
    reason: str
    requires_rejudge: bool
    status: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_patch(cls, patch: RepairPatch) -> "RepairPatchRead":
        """从数据库补丁模型展开面向 API 的修复契约。"""

        patch_payload: dict[str, Any] = patch.patch or {}
        return cls(
            id=patch.id,
            issue_id=patch.judge_issue_id,
            target_span=str(patch_payload.get("target_span", "")),
            replacement_text=str(patch_payload.get("replacement_text", "")),
            reason=patch.rationale or "",
            requires_rejudge=bool(patch_payload.get("requires_rejudge", True)),
            status=patch.status,
            created_at=patch.created_at,
            updated_at=patch.updated_at,
        )
