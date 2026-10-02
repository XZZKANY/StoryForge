"""Short continuation request and bounded single-owner background dispatch."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from threading import Lock

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.external_admission import require_managed_protocol
from app.domains.agent_runs.fs.delivery_audit import inspect_delivery_audit
from app.domains.agent_runs.loop.external_chat import ExternalExecutionLease
from app.domains.agent_runs.loop.external_wait_lifecycle import claim_external_execution
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.loop.external_wait_store import (
    commit_external_transition,
    external_authority_sequence,
    read_external_wait,
)
from app.domains.agent_runs.models import AgentRunEvent
from app.domains.agent_runs.service_store import get_agent_run

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="agent-external-resume")
_lock = Lock()
_scheduled: set[tuple[int, str]] = set()
_rerun: set[tuple[int, str]] = set()


def park_failed_external_dispatch(bind, run_id: str) -> None:
    """Dispatch failure is durable/visible, not a silently ready wait or an unsafe retry."""
    from app.domains.agent_runs.loop.external_wait_lifecycle import park_external_wait

    with Session(bind, expire_on_commit=False) as session:
        run = get_agent_run(session, run_id)
        if run.status not in {"running", "paused"}:
            return
        current = read_external_wait(session, run)
        if current.wait.execution_epoch is not None:
            park_external_wait(session, run, reason="external_dispatch_failed")


def request_external_continuation(session: Session, run, *, wait_id: str, expected_revision: int,
                                  execution_epoch: str, host_generation: str):
    require_managed_protocol(host_generation)
    current = read_external_wait(session, run)
    wait = current.wait
    authority_sequence = external_authority_sequence(session, run, wait)
    if (wait.wait_id != wait_id or wait.revision != expected_revision or wait.execution_epoch != execution_epoch
            or wait.stage not in {"receipt_ready", "claimed"} or not wait.feedback_consumed or run.status != "paused"
            or (wait.stage == "claimed" and wait.recovery_id is None)
            or current.prepared.payload.get("external_execution", {}).get("host_generation") != host_generation):
        raise ExternalWritebackConflict("external_continuation_not_ready")
    if wait.decision != "reject" and wait.observation.state == "applied" and not inspect_delivery_audit(wait.binding()):
        raise ExternalWritebackConflict("external_delivery_audit_required")
    if wait.delivery_complete:
        return current
    updated = wait.model_copy(update={"revision": wait.revision + 1, "delivery_complete": True})
    return commit_external_transition(session, run, previous=current, prepared=current.prepared, wait=updated,
                                      event_type="agent_writeback_continue_requested", require_host_open=True,
                                      cancel_after_sequence=authority_sequence)


def execute_ready_external_run(bind, run_id: str) -> bool:
    """No polling/automatic startup resume. A live request/worker exit may kick this."""
    from app.domains.agent_runs.service import execute_agent_user_message_run
    from app.domains.agent_runs.service_execution import agent_execution_state

    with Session(bind, expire_on_commit=False) as session:
        run = get_agent_run(session, run_id)
        current = read_external_wait(session, run)
        wait = current.wait
        if (run.status != "paused" or wait.stage not in {"receipt_ready", "claimed"} or wait.execution_epoch is None
                or (wait.stage == "claimed" and wait.recovery_id is None)
                or not wait.delivery_complete or agent_execution_state(session, run) != "settled"):
            return False
        generation = current.prepared.payload.get("external_execution", {}).get("host_generation")
        require_managed_protocol(generation)
        if wait.decision != "reject" and wait.observation.state == "applied" and not inspect_delivery_audit(wait.binding()):
            raise ExternalWritebackConflict("external_delivery_audit_required")
        claimed = claim_external_execution(session, run, wait_id=wait.wait_id, expected_revision=wait.revision,
                                           execution_epoch=wait.execution_epoch, delivery_complete=True)
        started = session.scalar(select(AgentRunEvent).where(
            AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == "agent_execution_started",
        ).order_by(AgentRunEvent.sequence.desc()).limit(1))
        lease = ExternalExecutionLease(run_id=run.public_id, session_id=run.session_id,
                                        execution_epoch=wait.execution_epoch, host_generation=generation)
        execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id,
                                       message=claimed.prepared.payload["resume_message"],
                                       external_lease=lease, started_event=started)
        return True


def schedule_external_resume(bind, run_id: str) -> None:
    """Process-local queue dedup is only load control; durable CAS owns execution."""
    key = (id(bind), run_id)
    with _lock:
        if key in _scheduled:
            _rerun.add(key)
            return
        if len(_scheduled) >= 64:
            raise ExternalWritebackConflict("external_dispatch_queue_full")
        _scheduled.add(key)

    def work():
        try:
            execute_ready_external_run(bind, run_id)
        except Exception:  # noqa: BLE001 - no unsafe retries and no body/secret logs
            # DB unavailable is not permission to replay the manuscript operation.
            with suppress(Exception):
                park_failed_external_dispatch(bind, run_id)
            return
        finally:
            with _lock:
                _scheduled.discard(key)
                again = key in _rerun
                _rerun.discard(key)
            if again:
                schedule_external_resume(bind, run_id)

    try:
        _executor.submit(work)
    except BaseException:
        with _lock:
            _scheduled.discard(key)
        raise
