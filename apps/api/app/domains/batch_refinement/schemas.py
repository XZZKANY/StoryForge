from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class BatchRefinementJobCreate(BaseModel):
    """早期批量精修 API 的同步执行请求。"""

    book_id: int = Field(gt=0)
    scene_ids: list[int] = Field(min_length=1, max_length=100)
    mode: str = Field(default="rewrite", max_length=50)
    required_facts: list[str] = Field(default_factory=list, max_length=100)
    style_rules: list[str] = Field(default_factory=list, max_length=100)


class BatchRefinementJobRead(BaseModel):
    """批量精修兼容响应，保留草稿测试约定的字段名。"""

    job_run_id: int
    status: str
    progress: dict[str, Any]
    issue_ids: list[int]
    patch_ids: list[int]
