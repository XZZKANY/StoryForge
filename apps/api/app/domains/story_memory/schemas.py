from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

MemoryEntityType = Literal["character", "location", "object", "faction", "world_rule", "relationship", "subplot"]
MemoryFactType = Literal["appearance", "status", "relationship", "rule", "location", "knowledge", "plot_thread"]
ConflictSeverity = Literal["low", "medium", "high", "blocking"]
ProposalOperation = Literal["create", "update", "delete", "annotate"]
ForeshadowLifecycleState = Literal["planted", "reinforced", "paid_off", "abandoned"]


class MemoryAtom(BaseModel):
    """长效记忆中的单条结构化事实，带章节有效区间和来源证据。"""

    memory_id: str = Field(min_length=1, max_length=255)
    novel_id: int = Field(gt=0)
    entity_type: MemoryEntityType
    entity_id: str = Field(min_length=1, max_length=255)
    fact_type: MemoryFactType
    value: str = Field(min_length=1, max_length=50000)
    source_ref: str = Field(min_length=1, max_length=1000)
    source_chapter_id: int | None = Field(default=None, gt=0)
    valid_from_chapter: int = Field(default=1, ge=1)
    valid_to_chapter: int | None = Field(default=None, ge=1)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    immutable: bool = False
    revision: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def validate_chapter_range(self) -> MemoryAtom:
        if self.valid_to_chapter is not None and self.valid_to_chapter < self.valid_from_chapter:
            raise ValueError("事实结束章节不能早于开始章节。")
        return self


class TimelineEvent(BaseModel):
    """时间线事件用于表达因果和章节顺序，避免长篇后期时间错乱。"""

    event_id: str = Field(min_length=1, max_length=255)
    novel_id: int = Field(gt=0)
    chapter_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=500)
    summary: str = Field(min_length=1, max_length=10000)
    participant_entity_ids: list[str] = Field(default_factory=list, max_length=500)
    causality_before_ids: list[str] = Field(default_factory=list, max_length=100)
    causality_after_ids: list[str] = Field(default_factory=list, max_length=100)
    source_ref: str = Field(min_length=1, max_length=1000)
    revision: int = Field(default=1, ge=1)


class Progression(BaseModel):
    """实体随章节演化的轨迹，参考 Novelcrafter Progressions。"""

    progression_id: str = Field(min_length=1)
    novel_id: int = Field(gt=0)
    entity_id: str = Field(min_length=1)
    fact_type: MemoryFactType
    atoms: list[MemoryAtom] = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def require_same_entity(self) -> Progression:
        if any(atom.entity_id != self.entity_id or atom.fact_type != self.fact_type for atom in self.atoms):
            raise ValueError("Progression 只能包含同一实体和同一事实类型的记忆。")
        return self


class MemoryConflict(BaseModel):
    """同一实体同一事实在重叠章节区间出现矛盾时生成冲突报告。"""

    conflict_id: str
    novel_id: int
    entity_id: str
    fact_type: MemoryFactType
    left_memory_id: str
    right_memory_id: str
    severity: ConflictSeverity
    reason: str
    source_refs: list[str]


class AgentProposal(BaseModel):
    """Agent 只能提交提案，不能直接写真相源。"""

    proposal_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    agent_name: str = Field(min_length=1)
    target_type: Literal["memory", "timeline", "chapter", "style", "outline"]
    target_id: str = Field(min_length=1)
    target_revision: int = Field(ge=1)
    operation: ProposalOperation
    diff: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    evidence_ids: list[str] = Field(default_factory=list, max_length=100)
    severity: ConflictSeverity = "medium"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ArbitrationDecision(BaseModel):
    """仲裁器输出，作为后续人工审批或自动合并的唯一入口。"""

    proposal_id: str
    decision: Literal["auto_merge", "needs_human", "reject"]
    reason: str
    blocked_by_conflict_ids: list[str] = Field(default_factory=list, max_length=100)


class ForeshadowLifecycleTransition(BaseModel):
    """伏笔生命周期转换请求，所有状态变化必须带章节、卷和原因。"""

    novel_id: int = Field(gt=0)
    foreshadow_id: str = Field(min_length=1, max_length=255)
    target_state: ForeshadowLifecycleState
    chapter_id: int = Field(gt=0)
    volume_id: int = Field(gt=0)
    evidence_refs: list[str] = Field(default_factory=list, max_length=100)
    transition_reason: str = Field(min_length=1, max_length=1000)
    source_ref: str | None = Field(default=None, min_length=1, max_length=255)


class ForeshadowLifecycleSnapshot(BaseModel):
    """伏笔生命周期快照，持久化在 story memory 的 plot_thread 事实中。"""

    memory_id: str = Field(min_length=1, max_length=255)
    novel_id: int = Field(gt=0)
    foreshadow_id: str = Field(min_length=1, max_length=255)
    state: ForeshadowLifecycleState
    requested_state: ForeshadowLifecycleState
    chapter_id: int = Field(gt=0)
    volume_id: int = Field(gt=0)
    evidence_refs: list[str] = Field(default_factory=list, max_length=100)
    transition_reason: str = Field(min_length=1, max_length=1200)
    revision: int = Field(ge=1)
    degraded: bool = False
