"""Explicit cold recovery, never automatic replay or a second user-message run."""

from __future__ import annotations

import math
import uuid
from copy import deepcopy
from pathlib import Path

from sqlalchemy import select

from app.domains.agent_runs.external_admission import require_managed_protocol
from app.domains.agent_runs.fs.delivery_audit import inspect_delivery_audit
from app.domains.agent_runs.fs.native_receipts import inspect_native_writeback
from app.domains.agent_runs.fs_safety import MAX_READ_BYTES, scoped_target
from app.domains.agent_runs.loop.checkpoint_store import tool_policy_digest
from app.domains.agent_runs.loop.external_chat import external_control_context, provider_configuration_digest
from app.domains.agent_runs.loop.external_observation import observe_external_transition
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.loop.external_wait_store import (
    commit_external_transition,
    latest_external_event_sequence,
    read_external_wait,
)
from app.domains.agent_runs.loop.recovery_sources import sources_unchanged
from app.domains.agent_runs.models import AgentRunEvent
from app.domains.agent_runs.service_execution import agent_execution_state
from app.platform.ai_sdk.runtime import RuntimePhase


def validate_recovery_checkpoint(current, run, permission_profile, source):
    payload, checkpoint = current.prepared.payload, current.prepared.checkpoint
    elapsed = payload.get("active_elapsed_seconds")
    execution = payload.get("external_execution")
    if (
        not isinstance(execution, dict)
        or permission_profile == "read"
        or permission_profile != run.permission_profile
        or permission_profile != payload.get("permission_profile")
        or payload.get("tool_policy_digest") != tool_policy_digest()
        or payload.get("dispatch_state") != "checkpointed"
        or checkpoint.phase in {RuntimePhase.TOOL_STARTED, RuntimePhase.COMPLETED, RuntimePhase.FAILED}
        or checkpoint.to_dict()["continuation_omitted"]
        or type(elapsed) not in {int, float}
        or not math.isfinite(elapsed)
        or elapsed < 0
        or execution.get("provider_configuration_digest") != provider_configuration_digest(source)
    ):
        raise ExternalWritebackConflict("external_recovery_checkpoint_unsafe")


def recover_external_wait(
    session, run, *, wait_id, expected_revision, expected_event_sequence, permission_profile, host_generation
):
    """Pure verification then ONE exact transaction; no owner/provider dispatch here."""
    generation = require_managed_protocol(host_generation)
    current = read_external_wait(session, run)
    wait = current.wait
    if (
        run.status != "paused"
        or wait.wait_id != wait_id
        or wait.revision != expected_revision
        or latest_external_event_sequence(session, run) != expected_event_sequence
        or agent_execution_state(session, run) != "settled"
    ):
        raise ExternalWritebackConflict("external_recovery_precondition_changed")
    # Stop is irreversible, including an audit committed before its row update.
    if (
        session.scalar(
            select(AgentRunEvent.id)
            .where(AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == "stop_run")
            .limit(1)
        )
        is not None
    ):
        raise ExternalWritebackConflict("external_recovery_stopped")
    from app.domains.assistant.service import resolved_llm_env

    validate_recovery_checkpoint(current, run, permission_profile, resolved_llm_env())
    context = external_control_context(session, run)
    prepared, output = current.prepared, None
    mode = "continue_verified" if wait.feedback_consumed else "await_confirmation"
    changes = {}
    if wait.identity is not None:
        try:
            observed = inspect_native_writeback(wait.binding())
        except (ValueError, OSError) as exc:
            raise ExternalWritebackConflict("external_recovery_receipt_unsafe") from exc
        if observed is None:
            if wait.feedback_consumed or wait.historical_applied:
                raise ExternalWritebackConflict("external_recovery_receipt_unsafe")
            # Retain original operation ID; a new explicit approval is still required.
            changes.update(stage="await_authorization", decision=None, observation=None)
        else:
            if (
                not observed.receipt_persisted
                or observed.state not in {"applied", "not_written"}
                or (observed.state == "applied" and observed.verified_after is None)
                or (observed.state == "not_written" and observed.current != "before")
            ):
                raise ExternalWritebackConflict("external_recovery_receipt_unsafe")
            if observed.state == "applied" and not inspect_delivery_audit(wait.binding()):
                return current, "audit_required"  # No epoch, checkpoint, or feedback mutation.
            if not wait.feedback_consumed:
                prepared, observation, output = observe_external_transition(context, current)
                if output is None:
                    raise ExternalWritebackConflict("external_recovery_receipt_unsafe")
                changes.update(
                    observation=observation,
                    feedback_consumed=True,
                    historical_applied=wait.historical_applied or observation.state == "applied",
                    stage="receipt_ready",
                )
            elif wait.observation is None or observed.state != wait.observation.state:
                raise ExternalWritebackConflict("external_recovery_receipt_unsafe")
            mode = "continue_verified"
    elif not wait.feedback_consumed:
        changes.update(stage="await_authorization", decision=None)
    elif wait.decision != "reject":
        raise ExternalWritebackConflict("external_recovery_receipt_unsafe")
    if mode == "await_confirmation":
        root = Path(wait.project_path).resolve(strict=True)
        target = scoped_target(root, root / wait.requested_path)
        with target.open("rb") as stream:
            raw = stream.read(MAX_READ_BYTES + 1)
        if str(root) != wait.canonical_root or raw != wait.raw_before.encode():
            raise ExternalWritebackConflict("external_recovery_baseline_changed")
    if not sources_unchanged(prepared.payload["sources"], prepared.payload["resume_message"]):
        raise ExternalWritebackConflict("external_recovery_sources_changed")
    payload = deepcopy(prepared.payload)
    execution_epoch = uuid.uuid4().hex
    payload["external_execution"] = {
        **payload["external_execution"],
        "host_generation": generation,
        "execution_epoch": execution_epoch,
    }
    from dataclasses import replace

    prepared = replace(prepared, payload=payload)
    recovery_id = uuid.uuid4().hex
    owner = session.scalar(
        select(AgentRunEvent)
        .where(AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == "agent_execution_started")
        .order_by(AgentRunEvent.sequence.desc())
        .limit(1)
    )
    if owner is None:
        raise ExternalWritebackConflict("external_recovery_owner_missing")
    updated = wait.model_copy(
        update={
            **changes,
            "revision": wait.revision + 1,
            "execution_id": owner.id,
            "execution_epoch": execution_epoch,
            "recovery_id": recovery_id,
            "control_sequence": expected_event_sequence,
            "delivery_complete": False,
            "manual_confirmation_required": mode == "await_confirmation",
        }
    )
    saved = commit_external_transition(
        session,
        run,
        previous=current,
        prepared=prepared,
        wait=updated,
        status="paused",
        event_type="agent_writeback_recovered",
        tool_output=output,
        require_host_open=True,
        expected_event_sequence=expected_event_sequence,
        cancel_after_sequence=expected_event_sequence,
        event_payload={
            "recovery_id": recovery_id,
            "control_sequence": expected_event_sequence,
            "host_generation": generation,
            "mode": mode,
        },
    )
    return saved, mode
