from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.domains.agent_runs.event_types import (
    AGENT_EXECUTION_CLAIMED,
    AGENT_EXECUTION_SETTLED,
    AGENT_EXECUTION_STARTED,
    AGENT_RUN_INTERRUPTED,
    PERMISSION_REQUIRED,
)
from app.domains.agent_runs.events.runtime_support import (
    pop_runtime_internal_markers,
    runtime_interrupted_response,
)
from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.domains.agent_runs.result_contracts import execution_result_payload
from app.domains.agent_runs.runtime_recovery import build_runtime_interruption_payload
from app.domains.agent_runs.service_store import record_agent_event, rollback_failed_settlement


def agent_execution_state(session: Session, run: AgentRun) -> str:
    """Durable ownership from started executions and committed resume claims."""
    latest = session.scalar(select(AgentRunEvent).where(
        AgentRunEvent.run_id == run.id,
        AgentRunEvent.event_type.in_({
            AGENT_EXECUTION_CLAIMED, AGENT_EXECUTION_STARTED, AGENT_EXECUTION_SETTLED, AGENT_RUN_INTERRUPTED,
        }),
    ).order_by(AgentRunEvent.sequence.desc()).limit(1))
    if latest is not None:
        if latest.event_type == AGENT_EXECUTION_CLAIMED:
            # The winning control owns the worker before its started event. A
            # pause in this gap requests interruption; it cannot free a new owner.
            claim_payload = latest.payload if isinstance(latest.payload, dict) else {}
            control_id = claim_payload.get("control_event_id")
            control = session.get(AgentRunEvent, control_id) if type(control_id) is int else None
            recovery = control.payload.get("runtime_recovery") if control is not None and isinstance(control.payload, dict) else None
            diagnostic = recovery.get("resume_diagnostic") if isinstance(recovery, dict) else None
            return "settled" if isinstance(diagnostic, dict) and diagnostic.get("can_resume") is False else "in_flight"
        if latest.event_type == AGENT_EXECUTION_STARTED:
            return "in_flight"
        active_owner = session.scalar(select(AgentRunEvent).where(
            AgentRunEvent.run_id == run.id,
            AgentRunEvent.event_type.in_({AGENT_EXECUTION_CLAIMED, AGENT_EXECUTION_STARTED}),
        ).order_by(AgentRunEvent.sequence.desc()).limit(1))
        owner = latest.payload.get("execution_id")
        if active_owner is not None and owner is not None and owner != active_owner.id:
            # A late finally cannot settle a newer worker or its pre-start claim.
            matching = session.scalar(select(AgentRunEvent.id).where(
                AgentRunEvent.run_id == run.id,
                AgentRunEvent.event_type.in_({AGENT_EXECUTION_SETTLED, AGENT_RUN_INTERRUPTED}),
                AgentRunEvent.sequence > active_owner.sequence,
                AgentRunEvent.payload["execution_id"].as_integer() == active_owner.id,
            ).limit(1))
            return "settled" if matching is not None else "in_flight"
        return "settled"
    # Existing parked/terminal runs have no worker; unstarted/running rows are not
    # proof of quiescence and must await their worker or explicit startup recovery.
    return "in_flight" if run.status == "running" else "settled"


def settle_abandoned_resume_claims(session: Session) -> None:
    """Startup only: no worker survives to consume a committed pre-start claim."""
    for run in session.scalars(select(AgentRun).where(AgentRun.book_run_id.is_(None))):
        latest = session.scalar(select(AgentRunEvent).where(
            AgentRunEvent.run_id == run.id,
            AgentRunEvent.event_type.in_({
                AGENT_EXECUTION_CLAIMED, AGENT_EXECUTION_STARTED,
            }),
        ).order_by(AgentRunEvent.sequence.desc()).limit(1))
        if (latest is not None and latest.event_type == AGENT_EXECUTION_CLAIMED
                and agent_execution_state(session, run) == "in_flight"):
            record_agent_event(session, run, event_type=AGENT_EXECUTION_SETTLED, actor="agent-runtime", payload={
                "runtime_state": "settled", "execution_id": latest.id,
                "run_status": run.status, "reason": "process_restart",
            })


def start_agent_execution(session: Session, run: AgentRun) -> AgentRunEvent:
    from app.domains.agent_runs.host_lifecycle import HOST_LIFECYCLE

    with HOST_LIFECYCLE.lock:
        HOST_LIFECYCLE.require_open()
        return record_agent_event(session, run, event_type=AGENT_EXECUTION_STARTED, actor="agent-runtime", payload={
            "runtime_state": "in_flight", "run_id": run.public_id, "session_id": run.session_id,
        })


def interrupted_result(session: Session, run: AgentRun, result: dict[str, Any] | None = None) -> dict[str, Any]:
    if result is None:
        prior = session.scalar(select(AgentRunEvent).where(
            AgentRunEvent.run_id == run.id,
            AgentRunEvent.event_type.in_({PERMISSION_REQUIRED, AGENT_RUN_INTERRUPTED}),
        ).order_by(AgentRunEvent.sequence.desc()).limit(1))
        payload = prior.payload if prior is not None and isinstance(prior.payload, dict) else {}
        raw = payload.get("execution_result")
        result = deepcopy(raw) if isinstance(raw, dict) else {
            "type": "agent_result", "session_id": run.session_id, "run_id": run.public_id,
            "assistant_session_id": run.assistant_session_id,
            "intent": payload.get("intent") or "chat.explain", "user_message": "",
            "plan": run.root_plan or [], "tool_trace": [], "agent_result": {}, "proposed_patch": None,
        }
    previous = result.get("runtime_interruption")
    interruption = (
        previous if isinstance(previous, dict) and previous.get("status") == run.status
        else build_runtime_interruption_payload(run, boundary="worker_settled")
    )
    if interruption is None:
        raise ValueError("interrupted result requires paused/stopped status")
    result["run_id"] = run.public_id
    runtime_interrupted_response(result, interruption)
    result["agent_result"].pop("proposed_patch", None)
    result["agent_result"]["writeback_blocked_until_user_confirms"] = False
    pop_runtime_internal_markers(result)
    return result


def settle_agent_run_interruption(
    session: Session, run: AgentRun, result: dict[str, Any] | None = None, *, execution_id: int | None = None,
) -> tuple[dict[str, Any], AgentRunEvent]:
    """Called only after a worker returns, or for an already-settled parked run."""
    result = interrupted_result(session, run, result)
    with rollback_failed_settlement(session):
        event = record_agent_event(session, run, event_type=AGENT_RUN_INTERRUPTED, actor="agent-runtime",
            message=str(result["agent_result"]["summary"]), payload={
                **execution_result_payload(result), "assistant_session_id": result.get("assistant_session_id"),
                "run_id": run.public_id, "session_id": run.session_id,
                "runtime_state": "settled", "execution_id": execution_id,
                "run_status": run.status,
            })
    return result, event


def finish_agent_execution(
    session: Session, run: AgentRun, started: AgentRunEvent, result: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, AgentRunEvent]:
    # A failed flush must not leave an active marker forever after the worker
    # unwinds; uncommitted failure state is rolled back before writing its exit.
    if not session.is_active:
        session.rollback()
    # Serialize final publication with new ownership claims. A stale finally may
    # retain its diagnostic history, but cannot publish a terminal for a new owner.
    with rollback_failed_settlement(session):
        owned = session.execute(update(AgentRun).where(
            AgentRun.id == run.id, AgentRun.execution_owner_event_id == started.id,
        ).values(current_step=AgentRun.current_step).execution_options(synchronize_session=False))
        session.refresh(run)
        if owned.rowcount != 1:
            event = record_agent_event(session, run, event_type=AGENT_EXECUTION_SETTLED, actor="agent-runtime", payload={
                "runtime_state": "settled", "execution_id": started.id,
                "run_status": run.status, "reason": "execution_superseded",
            })
            if run.status in {"paused", "stopped"}:
                result = interrupted_result(session, run, result)
            return result, event
        return _finish_owned_execution(session, run, started, result)


def _finish_owned_execution(
    session: Session, run: AgentRun, started: AgentRunEvent, result: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, AgentRunEvent]:
    from app.domains.agent_runs.loop.external_wait_state import is_external_step

    external_wait = is_external_step(run.current_step)
    from app.domains.agent_runs.host_lifecycle import HOST_LIFECYCLE

    if HOST_LIFECYCLE.closing and run.status == "running":
        latest_owner = session.scalar(select(AgentRunEvent.id).where(
            AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == AGENT_EXECUTION_STARTED,
        ).order_by(AgentRunEvent.sequence.desc()).limit(1))
        if external_wait and latest_owner == started.id:
            from app.domains.agent_runs.loop.external_wait_lifecycle import park_external_wait

            park_external_wait(session, run, reason="managed_host_closing")
            event = session.scalar(select(AgentRunEvent).where(
                AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == AGENT_EXECUTION_SETTLED,
                AgentRunEvent.payload["execution_id"].as_integer() == started.id,
            ).order_by(AgentRunEvent.sequence.desc()).limit(1))
            return result, event
        elif not external_wait:
            with rollback_failed_settlement(session):
                session.execute(update(AgentRun).where(AgentRun.id == run.id, AgentRun.status == "running")
                                .values(status="paused").execution_options(synchronize_session=False))
                session.refresh(run)
                if run.status in {"paused", "stopped"}:
                    return settle_agent_run_interruption(session, run, result, execution_id=started.id)
    confirmation_wait = (
        run.status == "paused"
        and run.current_step in {"permission.confirm", "chapter.brief.confirm"}
        and isinstance(result, dict)
        and isinstance(result.get("agent_result"), dict)
        and result["agent_result"].get("requires_user_confirmation") is True
    )
    if not external_wait and (run.status == "stopped" or (run.status == "paused" and not confirmation_wait)):
        return settle_agent_run_interruption(session, run, result, execution_id=started.id)
    if confirmation_wait and run.current_step == "chapter.brief.confirm":
        # The fixed Chapter Brief adapter uses an internal interruption marker to
        # skip ordinary completion. Public approval waits are not author cancels.
        result["agent_result"].pop("runtime_interrupted", None)
        result.pop("runtime_interruption", None)
    event = record_agent_event(session, run, event_type=AGENT_EXECUTION_SETTLED, actor="agent-runtime", payload={
        "runtime_state": "settled", "execution_id": started.id, "run_status": run.status,
        "run_id": run.public_id, "session_id": run.session_id,
    })
    return result, event
