from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

GroundingHardStatus = Literal["pass", "fail"]
GroundingSemanticStatus = Literal["not_run", "advisory"]


class StateChangeInput(BaseModel):
    """Writer 自报的单条 CHANGES 结构化项。"""

    change_type: str = Field(min_length=1, max_length=80)
    entity_kind: str = Field(min_length=1, max_length=80)
    entity_id: str = Field(min_length=1, max_length=160)
    object_id: str | None = Field(default=None, max_length=160)
    payload: dict[str, object] = Field(default_factory=dict)
    surface_forms: list[str] = Field(default_factory=list)
    canonical_name: str | None = Field(default=None, max_length=255)
    aliases: list[str] = Field(default_factory=list)
    seq: int | None = Field(default=None, ge=1)


class StoryStateGroundingResult(BaseModel):
    """单条 CHANGES 的 grounding 判定结果。"""

    seq: int
    entity_id: str
    hard: GroundingHardStatus
    surface_forms: list[str]
    matched_surface_forms: list[str] = Field(default_factory=list)
    reason: str | None = None
    semantic_status: GroundingSemanticStatus = "not_run"
    semantic_score: int | None = None
    semantic_reason: str | None = None


class CommittedStoryStateEvent(BaseModel):
    """服务层返回的已落库事件摘要。"""

    event_id: int
    chapter_index: int
    seq: int
    change_type: str
    entity_kind: str
    entity_id: str
    object_id: str | None = None


class CommitStoryStateResult(BaseModel):
    """一次章节状态提交的结果。"""

    events: list[CommittedStoryStateEvent]
    grounding: list[StoryStateGroundingResult]
    ledger_updates: int
    edge_count: int = 0
