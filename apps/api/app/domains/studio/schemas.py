from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class StudioBookListItem(BaseModel):
    """Studio 作品列表只暴露首个读取 spike 需要的最小字段。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    recent_chapter_ordinal: int | None


class StudioChapterGoalRead(BaseModel):
    """Studio 章节目标读取单章创作前置所需的最小事实。"""

    book_id: int
    target_chapter_id: int
    target_chapter_ordinal: int
    target_chapter_title: str
    chapter_goal: str
    previous_chapter_summary: str | None
    continuity_constraints: list[str]


class StudioScenePacketRead(BaseModel):
    """Studio Scene Packet 读取只暴露页面所需的摘要字段。"""

    book_id: int
    target_chapter_ordinal: int
    scene_id: int
    scene_packet_id: int
    status: str
    chapter_goal: str | None
    evidence_count: int
    compiled_context_id: str | None
    budget_summary: dict[str, Any]


class StudioJudgeIssueRead(BaseModel):
    """Studio Judge 评审摘要中的单条问题。"""

    id: int
    category: str
    severity: str
    summary: str
    span_start: int
    span_end: int
    recommended_repair_mode: str


class StudioJudgeReviewRead(BaseModel):
    """Studio Judge 读取只暴露评审摘要和关键问题。"""

    scene_packet_id: int
    status: str
    issue_count: int
    highest_severity: str | None
    score: int
    issues: list[StudioJudgeIssueRead]
