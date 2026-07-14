from __future__ import annotations

from typing import Any, cast

from app.common.redaction import redact_sensitive
from app.domains.agent_runs.event_types import (
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    PERMISSION_APPROVED,
    PERMISSION_DENIED,
    PERMISSION_REQUIRED,
    STOP_RUN,
)
from app.domains.agent_runs.events.save_point_projection import (
    blocked_tool as _blocked_tool,
)
from app.domains.agent_runs.events.save_point_projection import (
    is_pending_runtime_call as _is_pending_runtime_call,
)
from app.domains.agent_runs.events.save_point_projection import (
    latest_artifact as _latest_artifact,
)
from app.domains.agent_runs.events.save_point_projection import (
    latest_event as _latest_event,
)
from app.domains.agent_runs.events.save_point_projection import (
    latest_runtime_pending_fact as _latest_runtime_pending_fact,
)
from app.domains.agent_runs.events.save_point_projection import (
    pending_runtime_tool as _pending_runtime_tool,
)
from app.domains.agent_runs.events.save_point_projection import (
    resume_strategy as _resume_strategy,
)
from app.domains.agent_runs.events.save_point_projection import (
    runtime_recovery_projection as _runtime_recovery_projection,
)
from app.domains.agent_runs.events.save_point_projection import (
    save_point_from_artifact as _save_point_from_artifact,
)
from app.domains.agent_runs.events.save_point_projection import (
    save_point_from_event as _save_point_from_event,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
)


def build_agent_run_save_point_projection(
    run: AgentRun,
    *,
    events: list[AgentRunEvent] | None = None,
    artifacts: list[AgentArtifact] | None = None,
) -> dict[str, Any]:
    """Project existing durable AgentRun facts into save point candidates.

    This is read-only scaffolding for stage 5. It does not make AgentRuntime
    interruptible and does not claim provider-stream recovery.
    """

    ordered_events = sorted(events if events is not None else list(run.events), key=lambda event: (event.sequence, event.id))
    ordered_artifacts = sorted(artifacts if artifacts is not None else list(run.artifacts), key=lambda artifact: artifact.id)
    save_points: list[dict[str, Any]] = []

    for event in ordered_events:
        save_point = _save_point_from_event(event)
        if save_point is not None:
            save_points.append(save_point)

    for artifact in ordered_artifacts:
        save_points.append(_save_point_from_artifact(artifact))

    latest_permission = _latest_event(ordered_events, PERMISSION_REQUIRED)
    latest_permission_decision = _latest_event(ordered_events, PERMISSION_APPROVED, PERMISSION_DENIED)
    proposed_patch = _latest_artifact(ordered_artifacts, "proposed_patch")
    checkpoint = _latest_artifact(ordered_artifacts, "bookrun_checkpoint")
    latest_pending_fact = _latest_runtime_pending_fact(ordered_artifacts)
    pending_call = latest_pending_fact if _is_pending_runtime_call(latest_pending_fact) else None
    active_pending_call = pending_call if run.status in {"paused", "running"} else None
    pending_resolution = _latest_artifact(ordered_artifacts, RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND)
    terminal_event = _latest_event(ordered_events, AGENT_RUN_COMPLETED, AGENT_RUN_FAILED, STOP_RUN)

    pending_permission = (
        latest_permission is not None
        and (latest_permission_decision is None or latest_permission_decision.sequence < latest_permission.sequence)
        and run.status == "paused"
    )

    projection: dict[str, Any] = {
        "run_id": run.public_id,
        "status": run.status,
        "current_step": run.current_step,
        "save_points": save_points,
        "pending": {
            "permission_required": pending_permission,
            "permission_event_id": latest_permission.id if pending_permission and latest_permission is not None else None,
            "blocked_tool": _blocked_tool(latest_permission) if pending_permission and latest_permission is not None else None,
            "proposed_patch_artifact_id": proposed_patch.id if proposed_patch is not None else None,
            "runtime_pending_call_artifact_id": active_pending_call.id
            if _is_pending_runtime_call(active_pending_call)
            else None,
            "runtime_pending_tool": _pending_runtime_tool(active_pending_call),
        },
        "recoverability": {
            "can_retry_from_checkpoint": checkpoint is not None,
            "latest_checkpoint_artifact_id": checkpoint.id if checkpoint is not None else None,
            "failed_without_checkpoint": run.status == "failed" and checkpoint is None,
            "terminal_event_id": terminal_event.id if terminal_event is not None else None,
            "resume_strategy": _resume_strategy(run, checkpoint=checkpoint, pending_permission=pending_permission),
        },
        "runtime_recovery": _runtime_recovery_projection(
            run,
            ordered_events,
            checkpoint=checkpoint,
            pending_call=active_pending_call,
            pending_resolution=pending_resolution,
        ),
        "interruption_model": {
            "uses_existing_paused_status": run.status == "paused",
            "uses_existing_stopped_status": run.status == "stopped",
            "has_interrupted_event": False,
        },
    }
    return cast(dict[str, Any], redact_sensitive(projection))
