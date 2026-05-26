from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

ContextBlockKind = Literal[
    "scene_goal",
    "immutable_fact",
    "memory_atom",
    "timeline_event",
    "retrieval_chunk",
    "style_rule",
    "user_instruction",
]

InjectionPosition = Literal["system", "memory", "scene", "evidence", "style", "user"]
ContextBlockPriority = Literal["required", "high", "medium", "low"]


class ContextBlock(BaseModel):
    """可被注入模型上下文的最小上下文块。"""

    block_id: str = Field(min_length=1)
    kind: ContextBlockKind
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    source_ref: str = Field(min_length=1)
    token_count: int = Field(gt=0)
    priority: ContextBlockPriority = "medium"
    injection_position: InjectionPosition = "evidence"
    score: float = Field(default=1.0, ge=0.0)
    reserved_tokens: int = Field(default=0, ge=0)
    metadata: dict[str, str | int | float | bool] = Field(default_factory=dict)


class ContextCompileRequest(BaseModel):
    """上下文编译请求，固定预算并保留各类 revision。"""

    novel_id: int = Field(gt=0)
    chapter_id: int = Field(gt=0)
    scene_id: int = Field(gt=0)
    token_budget: int = Field(gt=0)
    outline_revision: int = Field(default=1, ge=1)
    memory_revision: int = Field(default=1, ge=1)
    timeline_revision: int = Field(default=1, ge=1)
    score_threshold: float = Field(default=0.0, ge=0.0)
    blocks: list[ContextBlock] = Field(min_length=1)

    @model_validator(mode="after")
    def require_budget_for_required_blocks(self) -> ContextCompileRequest:
        required_tokens = sum(block.token_count for block in self.blocks if block.priority == "required")
        if required_tokens > self.token_budget:
            raise ValueError("必保留上下文已经超过总预算，请先拆分场景或提高预算。")
        return self


class InjectedContextBlock(BaseModel):
    """最终进入模型上下文的块，保留排序和预算解释。"""

    block_id: str
    kind: ContextBlockKind
    title: str
    content: str
    source_ref: str
    token_count: int
    injection_position: InjectionPosition
    priority: ContextBlockPriority
    score: float
    order: int
    reason: str
    metadata: dict[str, str | int | float | bool] = Field(default_factory=dict)


class DroppedContextBlock(BaseModel):
    """被裁剪或过滤的上下文块，用于 Context Inspector 调试。"""

    block_id: str
    kind: ContextBlockKind
    title: str
    source_ref: str
    token_count: int
    priority: ContextBlockPriority
    score: float
    reason: str


class ContextBudgetReport(BaseModel):
    """上下文预算报告，解释本次编译如何使用窗口。"""

    token_budget: int
    used_tokens: int
    reserved_tokens: int
    dropped_tokens: int
    truncated: bool


class CompiledContext(BaseModel):
    """已编译上下文，供 Scene Packet、ModelRun 和 workflow 引用。"""

    compiled_context_id: str
    novel_id: int
    chapter_id: int
    scene_id: int
    outline_revision: int
    memory_revision: int
    timeline_revision: int
    injected_blocks: list[InjectedContextBlock]
    dropped_blocks: list[DroppedContextBlock]
    budget_report: ContextBudgetReport
    debug_summary: list[str]


class WorkflowStateReference(BaseModel):
    """workflow 只能保存引用型状态，禁止把全文和全量记忆塞入 checkpoint。"""

    job_id: str = Field(min_length=1)
    novel_id: int = Field(gt=0)
    chapter_id: int = Field(gt=0)
    scene_id: int = Field(gt=0)
    compiled_context_id: str = Field(min_length=1)
    outline_revision: int = Field(ge=1)
    memory_revision: int = Field(ge=1)
    timeline_revision: int = Field(ge=1)
    model_run_ids: list[str] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    current_step: str = Field(min_length=1)
    error_code: str | None = None
