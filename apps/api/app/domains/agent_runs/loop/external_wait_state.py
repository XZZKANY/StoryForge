"""Private v2 wait envelope. This is not a public DTO or a feature admission gate."""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.domains.agent_runs.fs.native_receipts import (
    NativeWritebackBinding,
    NativeWritebackIdentity,
    bind_native_writeback,
    raw_sha256,
)
from app.domains.agent_runs.fs_safety import MAX_READ_BYTES, scoped_target
from app.domains.agent_runs.loop.checkpoint_store import PreparedCheckpoint, payload_digest
from app.domains.agent_runs.loop.recovery_sources import file_digest
from app.domains.agent_runs.models import AgentRun
from app.platform.ai_sdk import MessageRole, RuntimeCheckpoint
from app.platform.ai_sdk.runtime import RuntimePhase, validate_external_checkpoint

PREFIX = "external-writeback:"
Hash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class ExternalWritebackConflict(ValueError):
    """An exact durable precondition changed; read the current wait, never replay."""


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class WholeFileProposal(StrictModel):
    id: str | int
    before: str
    after: str
    requires_confirmation: bool


class ReceiptObservation(StrictModel):
    state: Literal["applied", "not_written", "outcome_unknown", "missing", "invalid"]
    current: Literal["before", "after", "diverged", "missing", "unreadable"] | None = None
    receipt_persisted: bool = False
    reason: str | None = None


class ExternalWait(StrictModel):
    protocol: Literal["external_writeback_v1"] = "external_writeback_v1"
    wait_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    revision: int = Field(ge=1)
    stage: Literal["await_authorization", "awaiting_receipt", "reconciliation", "receipt_ready", "claimed"]
    run_id: str
    session_id: str
    assistant_session_id: int
    tool_call_id: str
    assistant_tool_call_id: int
    execution_id: int
    execution_epoch: str | None
    project_path: str
    canonical_root: str
    requested_path: str
    target: str
    proposal: WholeFileProposal
    raw_before: str
    before_hash: Hash
    after_hash: Hash
    operation_key: str
    source: str
    identity: NativeWritebackIdentity | None = None
    decision: Literal["approve", "auto", "reject"] | None = None
    observation: ReceiptObservation | None = None
    historical_applied: bool = False
    feedback_consumed: bool = False
    delivery_complete: bool = False
    control_sequence: int | None = Field(default=None, ge=1)
    recovery_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    manual_confirmation_required: bool = False

    @property
    def token(self) -> str:
        return f"{PREFIX}{self.wait_id}:{self.revision}:{self.stage}"

    def binding(self) -> NativeWritebackBinding:
        if self.identity is None:
            raise ExternalWritebackConflict("native_identity_not_bound")
        binding = bind_native_writeback(
            project_path=Path(self.project_path), requested_path=self.requested_path,
            operation_key=self.operation_key, source=self.source, content=self.proposal.after,
            raw_before=self.raw_before.encode("utf-8"), identity=self.identity,
        )
        if (str(binding.canonical_root) != self.canonical_root
                or binding.before_hash != self.before_hash or binding.after_hash != self.after_hash):
            raise ExternalWritebackConflict("frozen_binding_changed")
        return binding


def is_external_step(step: str | None) -> bool:
    return isinstance(step, str) and step.startswith(PREFIX)


def encode_wait(prepared: PreparedCheckpoint, wait: ExternalWait) -> PreparedCheckpoint:
    payload = deepcopy(prepared.payload)
    payload.update(version=2, external_wait=wait.model_dump(mode="json"), write_budget_used=1)
    payload["sha256"] = payload_digest(payload)
    return PreparedCheckpoint(prepared.checkpoint, payload, deepcopy(prepared.sources))


def _decode_wait(payload: dict[str, Any], run: AgentRun) -> ExternalWait:
    if (type(payload.get("version")) is not int or payload["version"] != 2
            or payload.get("sha256") != payload_digest(payload) or payload.get("redacted")
            or type(payload.get("write_budget_used")) is not int or payload["write_budget_used"] != 1):
        raise ExternalWritebackConflict("invalid_external_checkpoint")
    wait = ExternalWait.model_validate(payload.get("external_wait"))
    if (wait.run_id != run.public_id or wait.session_id != run.session_id
            or wait.assistant_session_id != run.assistant_session_id
            or payload.get("assistant_session_id") != run.assistant_session_id
            or payload.get("resume_message", {}).get("args", {}).get("project_path") != wait.project_path):
        raise ExternalWritebackConflict("external_checkpoint_identity_mismatch")
    cp = RuntimeCheckpoint.from_dict(payload["checkpoint"])
    if cp.run_id != run.public_id or cp.to_dict()["continuation_omitted"]:
        raise ExternalWritebackConflict("external_checkpoint_not_resumable")
    if wait.feedback_consumed:
        if (wait.stage not in {"receipt_ready", "claimed"}
                or (wait.stage == "receipt_ready" and cp.phase is not RuntimePhase.AFTER_TOOL)
                or sum(m.role is MessageRole.TOOL and m.tool_call_id == wait.tool_call_id for m in cp.messages) != 1):
            raise ExternalWritebackConflict("external_feedback_mismatch")
        if ((cp.pending is not None and (wait.stage != "claimed" or cp.pending.call_id == wait.tool_call_id))
                or cp.external_operation_id is not None or wait.tool_call_id not in cp.completed_tool_call_ids):
            raise ExternalWritebackConflict("external_feedback_mismatch")
    else:
        validate_external_checkpoint(cp)
        if (wait.stage in {"receipt_ready", "claimed"} or cp.pending.call_id != wait.tool_call_id
                or cp.external_operation_id != wait.wait_id):
            raise ExternalWritebackConflict("external_pending_mismatch")
    if (raw_sha256(wait.raw_before.encode("utf-8")) != wait.before_hash
            or raw_sha256(wait.proposal.after.encode("utf-8")) != wait.after_hash
            or wait.raw_before.replace("\r\n", "\n").replace("\r", "\n") != wait.proposal.before
            or wait.operation_key != f"{wait.proposal.id}:whole"
            or wait.source != json.dumps([wait.proposal.id, wait.proposal.before, wait.proposal.after, run.public_id],
                                         ensure_ascii=False, separators=(",", ":"))):
        raise ExternalWritebackConflict("external_proposal_mismatch")
    return wait



def decode_wait(payload: dict[str, Any], run: AgentRun) -> ExternalWait:
    try:
        return _decode_wait(payload, run)
    except ExternalWritebackConflict:
        raise
    except (ValidationError, ValueError, TypeError, KeyError, AttributeError):
        # Parser diagnostics can contain manuscript values; expose only a fixed code.
        raise ExternalWritebackConflict("invalid_external_checkpoint") from None


def transfer_sources(payload: dict[str, Any], wait: ExternalWait, *, applied: bool) -> dict[str, Any]:
    """Advance only the verified target and stable aliases; never resnapshot peers."""
    sources = deepcopy(payload["sources"])
    root = Path(wait.project_path).resolve(strict=True)
    if str(root) != wait.canonical_root or sources.get("project_root") != str(root):
        raise ExternalWritebackConflict("project_identity_changed")
    target = scoped_target(root, root / wait.requested_path)
    if target.relative_to(root).as_posix() != wait.target:
        raise ExternalWritebackConflict("target_identity_changed")
    seen = False
    for alias, ref in sources["files"].items():
        path = scoped_target(root, root / alias)
        if path.relative_to(root).as_posix() != ref["path"]:
            raise ExternalWritebackConflict("source_identity_changed")
        if path == target:
            if ref["sha256"] != wait.before_hash:
                raise ExternalWritebackConflict("raw_baseline_mismatch")
            seen = True
            if applied:
                ref["sha256"] = wait.after_hash
        elif file_digest(path) != ref["sha256"]:
            raise ExternalWritebackConflict("source_version_changed")
    if not seen:
        raise ExternalWritebackConflict("missing_target_baseline")
    return sources


def validate_proposal_bytes(proposal: WholeFileProposal, raw_before: bytes) -> str:
    if not str(proposal.id) or len(raw_before) > MAX_READ_BYTES or len(proposal.after.encode("utf-8")) > MAX_READ_BYTES:
        raise ExternalWritebackConflict("proposal_budget_exceeded")
    raw = raw_before.decode("utf-8", errors="strict")
    if raw.replace("\r\n", "\n").replace("\r", "\n") != proposal.before:
        raise ExternalWritebackConflict("raw_baseline_mismatch")
    return raw
