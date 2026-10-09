from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.common.redaction import redact_sensitive, redact_sensitive_text


class ChapterCheckHistoryQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_root: str = Field(min_length=1, max_length=32768)
    assistant_session_id: int = Field(ge=1, strict=True)
    limit: int = Field(default=20, ge=1, le=50, strict=True)


class ChapterCheckEvidenceRead(BaseModel):
    run_id: str
    check_artifact_id: int
    created_at: datetime
    target_path: str | None
    check: dict[str, Any]
    candidate: dict[str, Any] | None
    candidate_artifact_id: int | None
    candidate_error: str | None

    @field_serializer("check", "candidate")
    def serialize_evidence(self, payload: dict[str, Any] | None) -> dict[str, Any] | None:
        return redact_sensitive(payload)


class ChapterCheckHistoryRead(BaseModel):
    project_root: str
    assistant_session_id: int
    entries: list[ChapterCheckEvidenceRead]
    truncated: bool


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

    @field_serializer("goal")
    def serialize_goal(self, goal: str) -> str:
        return redact_sensitive_text(goal)

    @field_serializer("scope", "budget", return_type=dict[str, Any])
    def serialize_sensitive_mapping(self, value: dict[str, Any]) -> dict[str, Any]:
        return redact_sensitive(value)

    @field_serializer("root_plan", return_type=list[dict[str, Any]])
    def serialize_root_plan(self, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return redact_sensitive(value)


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

    @field_serializer("message")
    def serialize_message(self, message: str) -> str:
        return redact_sensitive_text(message)

    @field_serializer("payload", return_type=dict[str, Any])
    def serialize_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        from app.domains.agent_runs.runtime_recovery import public_runtime_event_payload

        return redact_sensitive(public_runtime_event_payload(self.event_type, payload))


class AgentArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    kind: str
    payload: dict[str, Any]
    requires_confirmation: bool
    created_at: datetime
    updated_at: datetime

    @field_serializer("payload", return_type=dict[str, Any])
    def serialize_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        return redact_sensitive(payload)


class KnowledgeProposalQuery(BaseModel):
    project_root: str


class KnowledgeProposalSourceRead(BaseModel):
    type: str
    path: str | None = None
    content_sha256: str | None = None
    agent_event_id: str | None = None
    locator: str | None = None
    title: str | None = None
    accessed_at: str | None = None
    summary_sha256: str | None = None


class KnowledgeConflictEntryRead(BaseModel):
    knowledge_id: str
    relative_path: str
    title: str
    claim: str
    status: str
    evidence_state: str
    sources: list[KnowledgeProposalSourceRead]


class KnowledgeProposalItemRead(BaseModel):
    proposal_id: str
    knowledge_id: str
    target_path: str
    operation: str
    title: str
    claim: str
    kind: str
    confidence: str
    sources: list[KnowledgeProposalSourceRead]
    related_knowledge_ids: list[str]
    reason: str
    claim_fingerprint: str
    state: str
    conflicts: list[KnowledgeConflictEntryRead] = Field(default_factory=list)


class KnowledgeProposalGroupRead(BaseModel):
    proposal_group_id: str
    artifact_id: int
    run_id: str
    revision: int
    state: str
    created_at: str
    proposals: list[KnowledgeProposalItemRead]


class KnowledgeProposalInboxRead(BaseModel):
    items: list[KnowledgeProposalGroupRead]
    pending_count: int


class KnowledgeProposalMaterializeRequest(BaseModel):
    project_root: str
    artifact_id: int
    revision: int
    proposal_id: str


class KnowledgeProposalPatchRead(BaseModel):
    id: str
    artifact_id: int
    kind: str
    patch_class: str
    proposal_id: str
    proposal_revision: int
    knowledge_id: str
    author_confirmation_event_id: str
    file_path: str
    relative_path: str
    before: str
    after: str
    baseline_hash: str
    requires_confirmation: bool
    created_by_tool: str


class KnowledgeProposalSourceEdit(BaseModel):
    type: str
    path: str | None = None
    locator: str | None = None
    title: str | None = None
    summary: str | None = None
    summary_sha256: str | None = None


class KnowledgeProposalItemEdit(BaseModel):
    target_path: str
    operation: str
    title: str
    claim: str
    kind: str
    confidence: str
    sources: list[KnowledgeProposalSourceEdit]
    related_knowledge_ids: list[str] = Field(default_factory=list)
    reason: str


class KnowledgeProposalReviseRequest(BaseModel):
    project_root: str
    artifact_id: int
    revision: int
    proposals: list[KnowledgeProposalItemEdit]


class KnowledgeProposalResolveRequest(BaseModel):
    project_root: str
    artifact_id: int
    revision: int
    proposal_id: str
    resolution: Literal["accepted", "rejected"]
    patch_identity: str | None = None
    author_confirmation_event_id: str | None = None
