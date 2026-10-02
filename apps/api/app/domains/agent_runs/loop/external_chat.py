"""Trusted chat execution ports. Renderer arguments never create an execution lease.

This module does not enable capabilities, spawn workers or write manuscripts.
The host admission adapter must issue the lease before calling the service.
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict, WholeFileProposal
from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.platform.ai_sdk import RuntimeToolResult

if TYPE_CHECKING:
    from app.domains.agent_runs.loop.external_wait_store import StoredExternalWait
    from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
    from app.domains.agent_runs.tools import ToolResult


@dataclass(frozen=True, kw_only=True)
class ExternalExecutionLease:
    run_id: str
    session_id: str
    execution_epoch: str
    host_generation: str

    def validate(self, run: AgentRun) -> None:
        if (self.run_id != run.public_id or self.session_id != run.session_id
                or not self.execution_epoch or not self.host_generation):
            raise ExternalWritebackConflict("external_execution_identity_mismatch")


@dataclass(frozen=True)
class PendingExternalProposal:
    wait_id: str
    proposal: WholeFileProposal
    raw_before: bytes
    assistant_tool_call_id: int


@dataclass
class ExternalChatExecution:
    lease: ExternalExecutionLease
    execution_id: int
    resumed: bool = False
    started_at: float = field(default_factory=time.monotonic)
    raw_inputs: dict[str, bytes] = field(default_factory=dict)
    pending: PendingExternalProposal | None = None
    stored: StoredExternalWait | None = None


def defer_external_proposal(context: StoryForgeRuntimeContext, registry_name: str,
                           result: ToolResult, evidence_id: int, arguments: dict) -> RuntimeToolResult | None:
    """Divert BEFORE legacy completed evidence, public artifacts and feedback."""
    execution = context.external_execution
    if execution is None or registry_name != "file.revise":
        return None
    if execution.pending is not None or context.write_budget_exhausted:
        raise ExternalWritebackConflict("write_budget_exhausted")
    raw = execution.raw_inputs.get(arguments.get("path"))
    proposal = result.patch_proposal
    if raw is None or proposal is None:
        raise ExternalWritebackConflict("missing_raw_proposal_baseline")
    value = proposal.to_payload()
    whole = WholeFileProposal(id=value["id"], before=value["before"], after=value["after"],
                             requires_confirmation=value["requires_confirmation"])
    from app.domains.agent_runs.loop.external_wait_state import validate_proposal_bytes

    validate_proposal_bytes(whole, raw)
    execution.pending = PendingExternalProposal(uuid.uuid4().hex, whole, raw, evidence_id)
    return RuntimeToolResult.deferred(execution.pending.wait_id)


def external_control_context(session: Session, run: AgentRun) -> StoryForgeRuntimeContext:
    """Receipt/control transactions require neither a provider nor a handler."""
    from app.domains.agent_runs.loop.external_wait_store import read_external_wait
    from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
    from app.domains.agent_runs.loop.types import ChatLoopOutcome
    from app.domains.agent_runs.permission import PermissionGate
    from app.domains.agent_runs.tools import list_loop_tool_specs, tool_definition_from_spec

    current = read_external_wait(session, run)

    def forbidden(*args, **kwargs):
        raise RuntimeError("external_control_never_dispatches_tools")

    return StoryForgeRuntimeContext(
        session=session, assistant_session_id=current.wait.assistant_session_id, run=run, source={},
        permission_gate=PermissionGate(), definitions={s.name: tool_definition_from_spec(s, forbidden)
                                                     for s in list_loop_tool_specs()},
        execute_tool=forbidden, on_trace=forbidden, outcome=ChatLoopOutcome(answer=""),
        recovery_message=current.prepared.payload["resume_message"],
        recovery_sources=current.prepared.sources, write_budget_used=1,
    )


def waiting_frame(session: Session, run: AgentRun, current: StoredExternalWait) -> dict:
    from app.domains.agent_runs.ws_messages import AgentRunWaitingFrame

    event = session.scalar(select(AgentRunEvent).where(
        AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == "agent_writeback_waiting",
    ).order_by(AgentRunEvent.sequence.desc()).limit(1))
    if event is None:
        raise ExternalWritebackConflict("external_wait_event_missing")
    return AgentRunWaitingFrame(session_id=run.session_id, run_id=run.public_id,
                                assistant_session_id=run.assistant_session_id,
                                event_id=event.id, sequence=event.sequence, wait_id=current.wait.wait_id,
                                revision=current.wait.revision, stage=current.wait.stage,
                                execution_epoch=current.wait.execution_epoch).to_wire()


def validate_execution_owner(session: Session, run: AgentRun, started: AgentRunEvent,
                             lease: ExternalExecutionLease, *, resumed: bool) -> None:
    lease.validate(run)
    latest = session.scalar(select(AgentRunEvent).where(
        AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == "agent_execution_started",
    ).order_by(AgentRunEvent.sequence.desc()).limit(1))
    if (latest is None or latest.id != started.id or started.run_id != run.id
            or started.event_type != "agent_execution_started" or run.status != "running"):
        raise ExternalWritebackConflict("external_execution_owner_mismatch")
    if resumed:
        from app.domains.agent_runs.loop.external_wait_store import read_external_wait

        current = read_external_wait(session, run)
        if (current.wait.stage != "claimed" or not current.wait.feedback_consumed
                or current.wait.execution_epoch != lease.execution_epoch
                or started.payload.get("execution_epoch") != lease.execution_epoch):
            raise ExternalWritebackConflict("external_execution_not_claimed")


def provider_configuration_digest(source) -> str:
    """Only non-credential execution settings; never include an API key, even hashed."""
    names = ("STORYFORGE_LLM_MODEL", "STORYFORGE_LLM_BASE_URL", "STORYFORGE_LLM_PROVIDER",
             "STORYFORGE_LLM_PROTOCOL", "STORYFORGE_LLM_WIRE_PROFILE")
    values = {name: source.get(name) for name in names}
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def external_boundary_interruption(context, boundary: str) -> str | None:
    """After loading, recheck frozen sources at every dispatch/publication boundary."""
    from app.domains.agent_runs.host_lifecycle import HOST_LIFECYCLE

    if HOST_LIFECYCLE.closing:
        context.interruption = {"status": "paused", "boundary": boundary, "reason": "managed_host_closing"}
        return "managed_host_closing"
    execution = context.external_execution
    if execution is None or not execution.resumed or execution.stored is None:
        return None
    from app.domains.agent_runs.loop.external_wait_lifecycle import park_external_wait
    from app.domains.agent_runs.loop.external_wait_store import read_external_wait
    from app.domains.agent_runs.loop.recovery_sources import sources_unchanged

    current = read_external_wait(context.session, context.run)
    if current.wait.execution_epoch is None:
        return "external_execution_parked"
    if not sources_unchanged(current.prepared.payload["sources"], current.prepared.payload["resume_message"]):
        park_external_wait(context.session, context.run, reason="external_source_changed_at_boundary")
        execution.stored = read_external_wait(context.session, context.run)
        context.interruption = {"status": "paused", "boundary": boundary}
        return "external_source_changed"
    return None
