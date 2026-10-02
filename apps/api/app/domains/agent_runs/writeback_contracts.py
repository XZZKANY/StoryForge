"""Public external-writeback contracts; no checkpoint body is a public DTO."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domains.agent_runs.fs.native_receipts import NativeWritebackIdentity
from app.domains.agent_runs.loop.external_wait_state import ReceiptObservation, WholeFileProposal

ExecutionProtocol = Literal["legacy", "external_writeback_v1"]


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class AgentCapabilitiesRead(BaseModel):
    execution_protocols: list[Literal["external_writeback_v1"]] = Field(default_factory=list)
    managed_host_generation: str | None = None
    disabled_reason: str | None = None


class WritebackRead(BaseModel):
    protocol: Literal["external_writeback_v1"] = "external_writeback_v1"
    run_id: str
    session_id: str
    assistant_session_id: int
    wait_id: str
    revision: int
    stage: Literal["await_authorization", "awaiting_receipt", "reconciliation", "receipt_ready", "claimed"]
    run_status: str
    runtime_state: Literal["in_flight", "settled"]
    event_sequence: int
    event_id: int
    project_path: str
    requested_path: str
    raw_before: str
    before_hash: str
    after_hash: str
    operation_key: str
    source: str
    proposal: WholeFileProposal
    identity: NativeWritebackIdentity | None
    decision: Literal["approve", "auto", "reject"] | None
    observation: ReceiptObservation | None
    historical_applied: bool
    feedback_consumed: bool
    delivery_complete: bool
    permission_profile: str
    continuation_available: bool
    # Never return an execution epoch to a cold REST reconstruction.


class WritebackPrepareRequest(StrictRequest):
    session_id: str = Field(min_length=1, max_length=160)
    expected_revision: int = Field(ge=1)
    identity: NativeWritebackIdentity | None = None
    decision: Literal["approve", "auto", "reject"]
    permission_profile: Literal["read", "ask", "auto", "full"]
    execution_epoch: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def identity_for_decision(self):
        if (self.decision == "reject") != (self.identity is None):
            raise ValueError("reject_has_no_identity; approve_and_auto_require_identity")
        return self


class WritebackRecoveryRequest(StrictRequest):
    session_id: str = Field(min_length=1, max_length=160)
    expected_revision: int = Field(ge=1)
    expected_event_sequence: int = Field(ge=1)
    permission_profile: Literal["read", "ask", "auto", "full"]


class WritebackRecoveryRead(BaseModel):
    writeback: WritebackRead
    mode: Literal["await_confirmation", "continue_verified", "audit_required"]
    execution_epoch: str | None = None


class WritebackRecoveryItem(BaseModel):
    run_id: str
    session_id: str
    wait_id: str | None = None
    revision: int | None = None
    event_sequence: int
    requested_path: str | None = None
    stage: str | None = None
    run_status: str
    historical_applied: bool = False
    blocked_reason: str | None = None
    native_state: str | None = None
    target_current: str | None = None
    audit_ready: bool | None = None


class WritebackRecoveryList(BaseModel):
    items: list[WritebackRecoveryItem]
    next_after_id: int | None = None


class WritebackReconcileRequest(StrictRequest):
    session_id: str = Field(min_length=1, max_length=160)
    expected_revision: int = Field(ge=1)
    resume_intent: Literal["observe_only", "continue_current_execution"] = "observe_only"
    execution_epoch: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def epoch_for_continuation(self):
        if self.resume_intent == "continue_current_execution" and self.execution_epoch is None:
            raise ValueError("continuation_requires_execution_epoch")
        return self
