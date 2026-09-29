from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.event_types import (
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
    """Durable execution ownership, not an inference from a control request/status."""
    latest = session.scalar(select(AgentRunEvent).where(
        AgentRunEvent.run_id == run.id,
        AgentRunEvent.event_type.in_({AGENT_EXECUTION_STARTED, AGENT_EXECUTION_SETTLED, AGENT_RUN_INTERRUPTED}),
    ).order_by(AgentRunEvent.sequence.desc()).limit(1))
    if latest is not None:
        return "in_flight" if latest.event_type == AGENT_EXECUTION_STARTED else "settled"
    # Existing parked/terminal runs have no worker; unstarted/running rows are not
    # proof of quiescence and must await their worker or explicit startup recovery.
    return "in_flight" if run.status == "running" else "settled"


def start_agent_execution(session: Session, run: AgentRun) -> AgentRunEvent:
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
    session.refresh(run)
    confirmation_wait = (
        run.status == "paused"
        and run.current_step in {"permission.confirm", "chapter.brief.confirm"}
        and isinstance(result, dict)
        and isinstance(result.get("agent_result"), dict)
        and result["agent_result"].get("requires_user_confirmation") is True
    )
    if run.status == "stopped" or (run.status == "paused" and not confirmation_wait):
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
