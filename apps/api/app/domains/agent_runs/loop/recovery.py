"""Control/startup integration for the bounded, evidence-backed chat resume path."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.domains.agent_runs.loop.checkpoint_store import checkpoint_diagnostic, latest_checkpoint_artifact
from app.domains.agent_runs.models import AgentRun


def park_checkpoint_run(session: Session, run: AgentRun, *, reason: str) -> None:
    from app.domains.agent_runs.loop.external_wait_lifecycle import park_external_wait
    from app.domains.agent_runs.loop.external_wait_state import is_external_step
    from app.domains.agent_runs.service_execution import interrupted_result, settle_agent_run_interruption
    from app.domains.agent_runs.service_store import rollback_failed_settlement

    if is_external_step(run.current_step):
        park_external_wait(session, run, reason=reason)
        return
    with rollback_failed_settlement(session):
        changed = session.execute(update(AgentRun).where(
            AgentRun.id == run.id, AgentRun.status.in_({"running", "paused"}),
        ).values(status="paused", current_step="runtime.recovery").execution_options(synchronize_session=False))
        session.refresh(run)
        if changed.rowcount != 1:
            return
        result = interrupted_result(session, run)
        artifact = latest_checkpoint_artifact(session, run)
        outcome = artifact.payload.get("outcome", {}) if artifact is not None else {}
        if isinstance(outcome, dict):
            result["tool_trace"] = outcome.get("traces", [])
            if isinstance(outcome.get("review_report"), dict):
                result["agent_result"]["review_report"] = outcome["review_report"]
        result["runtime_recovery"] = {
            "reason": reason, "can_resume": reason == "durable_checkpoint_ready",
            "resume_strategy": "continue_checkpoint" if reason == "durable_checkpoint_ready" else "reconciliation_required",
        }
        settle_agent_run_interruption(session, run, result)


def park_orphaned_checkpoint_run(session: Session, run: AgentRun) -> bool:
    artifact = latest_checkpoint_artifact(session, run)
    if artifact is None:
        return False
    diagnostic = checkpoint_diagnostic(artifact.payload, run)
    park_checkpoint_run(session, run, reason=diagnostic["reason"])
    return True


def resume_checkpoint_run(
    session: Session, run: AgentRun, *, agent_session_id: str, execute_run: Callable[..., dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    artifact = latest_checkpoint_artifact(session, run)
    if artifact is None:
        return None, None
    diagnostic = {**checkpoint_diagnostic(artifact.payload, run), "artifact_id": artifact.id}
    message = artifact.payload.get("resume_message")
    if not isinstance(message, dict) or not message.get("args", {}).get("project_path"):
        diagnostic.update(can_resume=False, reason="missing_resume_context",
                          resume_strategy="reconciliation_required", resume_via_control_channel=False)
    if not diagnostic["can_resume"]:
        park_checkpoint_run(session, run, reason=diagnostic["reason"])
        return None, diagnostic
    result = execute_run(session, run=run, agent_session_id=agent_session_id,
                         message={**message, "run_id": run.public_id})
    result["run_id"] = run.public_id
    return result, None


def checkpoint_recovery_projection(session: Session, run: AgentRun, projection: dict[str, Any]) -> None:
    artifact = latest_checkpoint_artifact(session, run)
    if artifact is None:
        return
    diagnostic = checkpoint_diagnostic(artifact.payload, run)
    # Completed/stopped runs and existing approval waits remain authoritative.
    from app.domains.agent_runs.service_execution import agent_execution_state

    settled = agent_execution_state(session, run) == "settled"
    can_resume = diagnostic["can_resume"] and settled and run.status == "paused" and run.current_step != "permission.confirm"
    if run.status == "paused" and not settled:
        diagnostic.update(reason="execution_in_flight", resume_strategy="await_settlement")
    diagnostic = {**diagnostic, "can_resume": can_resume, "artifact_id": artifact.id,
                  "resume_via_control_channel": can_resume}
    projection["runtime_recovery"]["checkpoint_resume"] = diagnostic
    projection["recoverability"]["can_resume"] = can_resume
    if run.status == "paused" and run.current_step != "permission.confirm":
        projection["recoverability"].update(
            resume_strategy=("await_settlement" if not settled else
                             "continue_checkpoint" if can_resume else "reconciliation_required"),
        )
        projection["runtime_recovery"]["manual_restart_required"] = False
