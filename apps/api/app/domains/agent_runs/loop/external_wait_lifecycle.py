"""Worker ownership and controls for private waits; claiming never calls a provider."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.event_types import (
    AGENT_EXECUTION_SETTLED,
    AGENT_EXECUTION_STARTED,
    PAUSE_RUN,
    STOP_RUN,
)
from app.domains.agent_runs.fs.native_receipts import NativeReceiptError, inspect_native_writeback
from app.domains.agent_runs.loop.checkpoint_store import tool_policy_digest
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict, is_external_step
from app.domains.agent_runs.loop.external_wait_store import (
    StoredExternalWait,
    commit_external_transition,
    external_authority_sequence,
    read_external_wait,
)
from app.domains.agent_runs.loop.recovery_sources import sources_unchanged
from app.domains.agent_runs.models import AgentRun, AgentRunEvent


def claim_external_execution(
    session: Session, run: AgentRun, *, wait_id: str, expected_revision: int,
    execution_epoch: str, delivery_complete: bool,
) -> StoredExternalWait:
    """One exact CAS starts ownership only after receipt, delivery and old worker exit.

    This is an internal port, not an HTTP input accepting delivery claims. The
    future coordinator/executor must call it only after guarded delivery succeeds.
    """
    from app.domains.agent_runs.service_execution import agent_execution_state

    current = read_external_wait(session, run)
    wait, payload = current.wait, current.prepared.payload
    latest_start = session.scalar(select(AgentRunEvent).where(
        AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == AGENT_EXECUTION_STARTED,
    ).order_by(AgentRunEvent.sequence.desc()).limit(1))
    if (wait.wait_id != wait_id or wait.revision != expected_revision or current.run_status != "paused"
            or wait.stage not in {"receipt_ready", "claimed"} or not wait.feedback_consumed
            or (wait.stage == "claimed" and wait.recovery_id is None)
            or wait.execution_epoch is None or wait.execution_epoch != execution_epoch
            or delivery_complete is not True or latest_start is None or latest_start.id != wait.execution_id
            or agent_execution_state(session, run) != "settled"):
        raise ExternalWritebackConflict("external_execution_not_ready")
    if (run.permission_profile != payload["permission_profile"]
            or payload["tool_policy_digest"] != tool_policy_digest()
            or not sources_unchanged(payload["sources"], payload["resume_message"])):
        raise ExternalWritebackConflict("external_execution_context_changed")
    if wait.decision != "reject":
        try:
            observation = inspect_native_writeback(wait.binding())
        except NativeReceiptError as exc:
            raise ExternalWritebackConflict("external_receipt_changed") from exc
        if (observation is None or not observation.receipt_persisted or wait.observation is None
                or observation.state != wait.observation.state
                or (observation.state == "applied" and observation.verified_after is None)
                or (observation.state == "not_written" and observation.current != "before")):
            raise ExternalWritebackConflict("external_receipt_changed")
    updated = wait.model_copy(update={"revision": wait.revision + 1, "stage": "claimed", "delivery_complete": True})
    return commit_external_transition(session, run, previous=current, prepared=current.prepared, wait=updated,
                                      status="running", event_type=AGENT_EXECUTION_STARTED, require_host_open=True,
                                      event_payload={"runtime_state": "in_flight", "execution_epoch": execution_epoch},
                                      cancel_after_sequence=external_authority_sequence(session, run, wait))


def handle_external_control(
    session: Session, run: AgentRun, event: AgentRunEvent, *, control_type: str, runtime_state: str,
) -> bool:
    if not is_external_step(run.current_step):
        return False
    current = read_external_wait(session, run)
    if control_type not in {PAUSE_RUN, STOP_RUN} or run.status in {"stopped", "completed", "failed"}:
        event.payload = {**event.payload, "control_effect": "ignored", "runtime_state": runtime_state,
                         "run_status": run.status, "reason": "external_writeback_control_required"}
        session.add(event)
        session.commit()
        return True
    effect = "requested" if runtime_state == "in_flight" else "applied"
    status = "stopped" if control_type == STOP_RUN else "paused"
    updated = current.wait.model_copy(update={"revision": current.wait.revision + 1, "execution_epoch": None})
    event.payload = {**event.payload, "control_effect": effect, "runtime_state": runtime_state, "run_status": status}
    session.add(event)
    commit_external_transition(session, run, previous=current, prepared=current.prepared, wait=updated,
                               status=status, event_type="agent_writeback_control")
    return True


def park_external_wait(session: Session, run: AgentRun, *, reason: str) -> None:
    """Startup/explicit recovery only: revoke epoch but retain original wait/facts."""
    current = read_external_wait(session, run)
    if run.status not in {"running", "paused"}:
        return
    latest_start = session.scalar(select(AgentRunEvent).where(
        AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == AGENT_EXECUTION_STARTED,
    ).order_by(AgentRunEvent.sequence.desc()).limit(1))
    execution_id = latest_start.id if latest_start is not None else current.wait.execution_id
    updated = current.wait.model_copy(update={"revision": current.wait.revision + 1, "execution_epoch": None,
                                             "execution_id": execution_id})
    commit_external_transition(session, run, previous=current, prepared=current.prepared, wait=updated,
                               status="paused", event_type=AGENT_EXECUTION_SETTLED,
                               event_payload={"runtime_state": "settled", "execution_id": execution_id,
                                              "reason": reason, "startup_parked": True})
