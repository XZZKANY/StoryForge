from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AgentRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: str
    session_id: str
    assistant_session_id: int | None
    book_run_id: int | None
    goal: str
    scope: dict[str, Any]
    permission_profile: str
    budget: dict[str, Any]
    status: str
    root_plan: list[dict[str, Any]]
    current_step: str | None
    created_at: datetime
    updated_at: datetime


class AgentSkillRead(BaseModel):
    """Root Agent 可选择的流程 skill；skill 只描述计划知识，不直接执行工具。"""

    name: str
    description: str
    trigger_intents: list[str]
    plan_template: list[dict[str, Any]]
    tool_sequence: list[str]
    output_artifacts: list[str]
    permission_profile: str


class AgentRoleRead(BaseModel):
    """Agent Runtime 的只读角色目录，用于 Root Agent 调度和权限边界判断。"""

    name: str
    display_name: str
    kind: str
    description: str
    aliases: list[str]
    read_only: bool
    default_permission_profile: str
    allowed_tools: list[str]
    output_artifacts: list[str]
    can_be_mentioned: bool


class AgentRunEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    event_type: str
    actor: str
    message: str
    payload: dict[str, Any]
    sequence: int
    created_at: datetime
    updated_at: datetime


class AgentArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    kind: str
    payload: dict[str, Any]
    requires_confirmation: bool
    created_at: datetime
    updated_at: datetime


class SubagentRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    parent_run_id: int | None
    role: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    status: str
    created_at: datetime
    updated_at: datetime
