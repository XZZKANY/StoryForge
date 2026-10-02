"""Short domain transactions. No provider, Native write, or notification in here."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.common.redaction import redact_sensitive
from app.domains.agent_runs.event_types import PAUSE_RUN, STOP_RUN, event_type_for_control_message
from app.domains.agent_runs.host_lifecycle import host_admission_context
from app.domains.agent_runs.loop.checkpoint_store import (
    PreparedCheckpoint,
    append_checkpoint,
    latest_checkpoint_artifact,
    payload_digest,
)
from app.domains.agent_runs.loop.external_wait_state import (
    ExternalWait,
    ExternalWritebackConflict,
    decode_wait,
    encode_wait,
)
from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.domains.agent_runs.service_store import record_agent_event, rollback_failed_settlement
from app.domains.assistant.models import AssistantToolCall
from app.platform.ai_sdk import RuntimeCheckpoint


@dataclass(frozen=True)
class StoredExternalWait:
    wait: ExternalWait
    prepared: PreparedCheckpoint
    run_status: str


def read_external_wait(session: Session, run: AgentRun) -> StoredExternalWait:
    session.refresh(run)
    item = latest_checkpoint_artifact(session, run)
    if item is None:
        raise ExternalWritebackConflict("external_checkpoint_missing")
    wait = decode_wait(item.payload, run)
    if run.current_step != wait.token:
        raise ExternalWritebackConflict("external_wait_token_mismatch")
    payload = deepcopy(item.payload)
    return StoredExternalWait(wait, PreparedCheckpoint(RuntimeCheckpoint.from_dict(payload["checkpoint"]),
                                                       payload, deepcopy(payload["sources"])), run.status)


def commit_external_transition(
    session: Session, run: AgentRun, *, previous: StoredExternalWait | None,
    prepared: PreparedCheckpoint, wait: ExternalWait, event_type: str,
    expected_step: str | None = None, status: str | None = None,
    tool_output: dict[str, Any] | None = None,
    tool_status: str = "completed",
    event_payload: dict[str, Any] | None = None,
    cancel_after_sequence: int | None = None,
    expected_event_sequence: int | None = None,
    require_host_open: bool = False,
) -> StoredExternalWait:
    """Exact token/status/profile CAS serializes writers before checkpoint/event INSERTs."""
    prepared = encode_wait(prepared, wait)
    decode_wait(prepared.payload, run)
    if redact_sensitive(prepared.payload) != prepared.payload:
        raise ExternalWritebackConflict("checkpoint_content_redacted")
    old_status = previous.run_status if previous is not None else "running"
    old_step = previous.wait.token if previous is not None else expected_step
    next_status = status or old_status
    with host_admission_context(require_host_open), rollback_failed_settlement(session):
        changed = session.execute(update(AgentRun).where(
            AgentRun.id == run.id, AgentRun.status == old_status,
            AgentRun.current_step == old_step,
            AgentRun.permission_profile == run.permission_profile,
        ).values(status=next_status, current_step=wait.token).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            raise ExternalWritebackConflict("external_wait_revision_conflict")
        if expected_event_sequence is not None and latest_external_event_sequence(session, run) != expected_event_sequence:
            raise ExternalWritebackConflict("external_event_sequence_conflict")
        if cancel_after_sequence is not None:
            # The control command audit commits before its status transition.
            # Recheck intent after acquiring the row: a lost control CAS must
            # not allow a ready receipt to dispatch a new segment.
            cancel = session.scalar(select(AgentRunEvent.id).where(
                AgentRunEvent.run_id == run.id, AgentRunEvent.sequence > cancel_after_sequence,
                AgentRunEvent.event_type.in_({event_type_for_control_message(PAUSE_RUN),
                                             event_type_for_control_message(STOP_RUN)}),
            ).limit(1))
            if cancel is not None:
                raise ExternalWritebackConflict("external_control_requested")
        # Do not use assistant_service helpers here: they commit before checkpoint/event.
        if tool_output is not None:
            changed_tool = session.execute(update(AssistantToolCall).where(
                AssistantToolCall.id == wait.assistant_tool_call_id,
                AssistantToolCall.session_id == wait.assistant_session_id,
                AssistantToolCall.status == "running",
            ).values(status=tool_status, output_summary=tool_output).execution_options(synchronize_session=False))
            if changed_tool.rowcount != 1:
                raise ExternalWritebackConflict("external_tool_evidence_conflict")
        append_checkpoint(session, run, prepared)
        record_agent_event(session, run, event_type=event_type, actor="external-writeback", payload={
            "protocol": wait.protocol, "run_id": wait.run_id, "session_id": wait.session_id,
            "wait_id": wait.wait_id, "revision": wait.revision, "stage": wait.stage,
            "tool_call_id": wait.tool_call_id, "feedback_consumed": wait.feedback_consumed,
            "historical_applied": wait.historical_applied,
            "observation": wait.observation.model_dump() if wait.observation else None,
            **(event_payload or {}),
        })
    session.refresh(run)
    return StoredExternalWait(wait, prepared, next_status)


def replace_checkpoint(prepared: PreparedCheckpoint, checkpoint: RuntimeCheckpoint,
                       sources: dict[str, Any]) -> PreparedCheckpoint:
    payload = deepcopy(prepared.payload)
    payload.update(checkpoint=checkpoint.to_dict(), sources=deepcopy(sources))
    payload["sha256"] = payload_digest(payload)
    return PreparedCheckpoint(checkpoint, payload, deepcopy(sources))


def assert_tool_evidence(session: Session, run: AgentRun, evidence_id: int, tool_name: str) -> None:
    evidence = session.scalar(select(AssistantToolCall).where(
        AssistantToolCall.id == evidence_id, AssistantToolCall.session_id == run.assistant_session_id,
        AssistantToolCall.status == "running", AssistantToolCall.tool_name == tool_name,
    ))
    if evidence is None:
        raise ExternalWritebackConflict("external_tool_evidence_conflict")


def external_authority_sequence(session: Session, run: AgentRun, wait: ExternalWait) -> int:
    """A recorded cancel revokes authority even before its row transition settles."""
    owner = session.get(AgentRunEvent, wait.execution_id)
    if owner is None or owner.run_id != run.id or owner.event_type != "agent_execution_started":
        raise ExternalWritebackConflict("execution_identity_mismatch")
    sequence = owner.sequence
    if wait.control_sequence is not None or wait.recovery_id is not None:
        marker = session.scalar(select(AgentRunEvent).where(
            AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == "agent_writeback_recovered",
        ).order_by(AgentRunEvent.sequence.desc()).limit(1))
        if (wait.control_sequence is None or wait.recovery_id is None or marker is None
                or marker.payload.get("recovery_id") != wait.recovery_id
                or marker.payload.get("control_sequence") != wait.control_sequence
                or marker.payload.get("wait_id") != wait.wait_id or marker.sequence <= wait.control_sequence):
            raise ExternalWritebackConflict("external_recovery_authority_invalid")
        sequence = max(sequence, wait.control_sequence)
    cancel = session.scalar(select(AgentRunEvent.id).where(
        AgentRunEvent.run_id == run.id, AgentRunEvent.sequence > sequence,
        AgentRunEvent.event_type.in_({event_type_for_control_message(PAUSE_RUN),
                                     event_type_for_control_message(STOP_RUN)}),
    ).limit(1))
    if cancel is not None:
        raise ExternalWritebackConflict("external_control_requested")
    return sequence


def latest_external_event_sequence(session: Session, run: AgentRun) -> int:
    sequence = session.scalar(select(AgentRunEvent.sequence).where(AgentRunEvent.run_id == run.id)
                              .order_by(AgentRunEvent.sequence.desc()).limit(1))
    if sequence is None:
        raise ExternalWritebackConflict("external_event_missing")
    return sequence
