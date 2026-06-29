from __future__ import annotations

from typing import Any

from app.domains.agent_runs.event_types import (
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    AGENT_RUN_STARTED,
    PAUSE_RUN,
    PERMISSION_APPROVED,
    PERMISSION_DENIED,
    PERMISSION_REQUIRED,
    RESUME_RUN,
    RETRY_FROM_CHECKPOINT,
    STOP_RUN,
    TOOL_TRACE,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    build_runtime_pending_call_summary,
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

    return {
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


def _save_point_from_event(event: AgentRunEvent) -> dict[str, Any] | None:
    if event.event_type == AGENT_RUN_STARTED:
        return _event_save_point("run_started", event)
    if event.event_type == PERMISSION_REQUIRED:
        return _event_save_point(
            "permission_required",
            event,
            {"blocked_tool": _blocked_tool(event), "requires_user_decision": True},
        )
    if event.event_type in {PERMISSION_APPROVED, PERMISSION_DENIED}:
        return _event_save_point("permission_decided", event, {"decision": event.event_type})
    if event.event_type == AGENT_RUN_COMPLETED:
        return _event_save_point("run_completed", event)
    if event.event_type == AGENT_RUN_FAILED:
        return _event_save_point("run_failed", event)
    if event.event_type == STOP_RUN:
        return _event_save_point("run_stopped", event)
    if event.event_type in {PAUSE_RUN, RESUME_RUN, RETRY_FROM_CHECKPOINT}:
        return _event_save_point("control_message", event, _control_event_summary(event))
    if event.event_type == TOOL_TRACE:
        return _event_save_point("tool_completed", event, _tool_recovery_summary(event))
    return None


def _save_point_from_artifact(artifact: AgentArtifact) -> dict[str, Any]:
    if artifact.kind == "bookrun_checkpoint":
        kind = "bookrun_checkpoint"
    elif artifact.kind == RUNTIME_PENDING_CALL_ARTIFACT_KIND:
        kind = RUNTIME_PENDING_CALL_ARTIFACT_KIND
    elif artifact.kind == RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND:
        kind = RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND
    else:
        kind = "artifact_persisted"
    return {
        "kind": kind,
        "source": "artifact",
        "artifact_id": artifact.id,
        "artifact_kind": artifact.kind,
        "requires_confirmation": artifact.requires_confirmation,
        "summary": _artifact_summary(artifact),
    }


def _event_save_point(event_kind: str, event: AgentRunEvent, summary: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "kind": event_kind,
        "source": "event",
        "event_id": event.id,
        "event_type": event.event_type,
        "sequence": event.sequence,
        "summary": summary or {},
    }


def _latest_event(events: list[AgentRunEvent], *event_types: str) -> AgentRunEvent | None:
    event_type_set = set(event_types)
    for event in reversed(events):
        if event.event_type in event_type_set:
            return event
    return None


def _latest_artifact(artifacts: list[AgentArtifact], kind: str) -> AgentArtifact | None:
    for artifact in reversed(artifacts):
        if artifact.kind == kind:
            return artifact
    return None


def _latest_runtime_pending_fact(artifacts: list[AgentArtifact]) -> AgentArtifact | None:
    for artifact in reversed(artifacts):
        if artifact.kind in {RUNTIME_PENDING_CALL_ARTIFACT_KIND, RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND}:
            return artifact
    return None


def _blocked_tool(event: AgentRunEvent | None) -> str | None:
    if event is None:
        return None
    value = event.payload.get("blocked_tool") if isinstance(event.payload, dict) else None
    return value if isinstance(value, str) and value else None


def _tool_trace_summary(event: AgentRunEvent) -> dict[str, Any]:
    payload = event.payload if isinstance(event.payload, dict) else {}
    trace = payload.get("trace") if isinstance(payload.get("trace"), dict) else {}
    summary: dict[str, Any] = {}
    tool_name = trace.get("tool_name")
    status = trace.get("status")
    audit_event_id = trace.get("audit_event_id")
    if isinstance(tool_name, str) and tool_name:
        summary["tool_name"] = tool_name
    if isinstance(status, str) and status:
        summary["status"] = status
    if isinstance(audit_event_id, str) and audit_event_id:
        summary["audit_event_id"] = audit_event_id
    index = payload.get("index")
    if isinstance(index, int):
        summary["index"] = index
    return summary


def _control_event_summary(event: AgentRunEvent) -> dict[str, Any]:
    payload = event.payload if isinstance(event.payload, dict) else {}
    summary: dict[str, Any] = {}
    for key in ("control_type", "reason", "source"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            summary[key] = value
    for key in ("run_id", "session_id"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            summary[key] = value
    for key in ("book_run_id", "writing_run_id"):
        value = payload.get(key)
        if isinstance(value, int):
            summary[key] = value
    writing_run = payload.get("writing_run") if isinstance(payload.get("writing_run"), dict) else {}
    book_run = payload.get("book_run") if isinstance(payload.get("book_run"), dict) else {}
    for source, prefix in ((writing_run, "writing_run"), (book_run, "book_run")):
        status = source.get("status")
        if isinstance(status, str) and status:
            summary[f"{prefix}_status"] = status
        mode = source.get("mode")
        if isinstance(mode, str) and mode:
            summary[f"{prefix}_mode"] = mode
        scope = source.get("scope")
        if isinstance(scope, str) and scope:
            summary[f"{prefix}_scope"] = scope
    return summary


def _tool_recovery_summary(event: AgentRunEvent) -> dict[str, Any]:
    payload = event.payload if isinstance(event.payload, dict) else {}
    recovery = payload.get("recovery") if isinstance(payload.get("recovery"), dict) else None
    if recovery is None:
        return _tool_trace_summary(event)
    summary: dict[str, Any] = {}
    for key in ("kind", "tool_name", "status", "execution_mode", "audit_event_id"):
        value = recovery.get(key)
        if isinstance(value, str) and value:
            summary[key] = value
    for key in ("index",):
        value = recovery.get(key)
        if isinstance(value, int):
            summary[key] = value
    for key in ("retry_safe", "idempotent"):
        value = recovery.get(key)
        if isinstance(value, bool):
            summary[key] = value
    artifact_kinds = recovery.get("artifact_kinds")
    if isinstance(artifact_kinds, list):
        summary["artifact_kinds"] = [item for item in artifact_kinds if isinstance(item, str)]
    marker = _execution_marker_summary(recovery)
    if marker is not None:
        summary["execution_marker"] = marker
    return summary or _tool_trace_summary(event)


def _artifact_summary(artifact: AgentArtifact) -> dict[str, Any]:
    payload = artifact.payload if isinstance(artifact.payload, dict) else {}
    summary: dict[str, Any] = {}
    for key in (
        "kind",
        "file_path",
        "book_run_id",
        "writing_run_id",
        "status",
        "intent",
        "boundary",
        "resume_strategy",
        "resolution",
        "resolved_by",
        "result_status",
        "pending_resume_strategy",
        "tokens_used",
        "token_budget",
        "completed_count",
        "current_chapter_index",
        "total_chapters",
        "checkpoint_count",
        "resume_from_chapter_index",
        "retry_from_chapter_index",
        "retry_checkpoint_chapter_index",
    ):
        value = payload.get(key)
        if isinstance(value, str | int | bool):
            summary[key] = value
    retry_checkpoint = payload.get("retry_checkpoint")
    if isinstance(retry_checkpoint, dict):
        for key in ("chapter_index", "status", "model_run_id", "judge_report_id", "approved_scene_id"):
            value = retry_checkpoint.get(key)
            if isinstance(value, str | int | bool):
                summary[f"retry_checkpoint_{key}"] = value
    pending_artifact_id = payload.get("pending_artifact_id")
    if isinstance(pending_artifact_id, int):
        summary["pending_artifact_id"] = pending_artifact_id
    context_output = payload.get("context_output") if isinstance(payload.get("context_output"), dict) else {}
    if context_output:
        file_path = context_output.get("file_path")
        content = context_output.get("content")
        if isinstance(file_path, str) and file_path:
            summary["file_path"] = file_path
        if isinstance(content, str):
            summary["content_chars"] = len(content)
    checkpoint = payload.get("checkpoint")
    if isinstance(checkpoint, list):
        summary["checkpoint_count"] = len(checkpoint)
        latest_checkpoint = _latest_checkpoint_entry(checkpoint)
        if latest_checkpoint is not None:
            chapter_index = latest_checkpoint.get("chapter_index")
            if isinstance(chapter_index, int):
                summary["latest_checkpoint_chapter_index"] = chapter_index
            for key in ("status", "model_run_id", "judge_report_id", "approved_scene_id"):
                value = latest_checkpoint.get(key)
                if isinstance(value, str | int | bool):
                    summary[f"latest_checkpoint_{key}"] = value
    return summary


def _latest_checkpoint_entry(checkpoint: list[object]) -> dict[str, Any] | None:
    for item in reversed(checkpoint):
        if isinstance(item, dict):
            return item
    return None


def _resume_strategy(run: AgentRun, *, checkpoint: AgentArtifact | None, pending_permission: bool) -> str:
    if checkpoint is not None:
        return "bookrun_checkpoint"
    if pending_permission:
        return "await_permission_decision"
    if run.status == "failed":
        return "manual_restart_required"
    if run.status == "stopped":
        return "stopped_by_user"
    return "none"


def _runtime_recovery_projection(
    run: AgentRun,
    events: list[AgentRunEvent],
    *,
    checkpoint: AgentArtifact | None,
    pending_call: AgentArtifact | None,
    pending_resolution: AgentArtifact | None,
) -> dict[str, Any]:
    markers: list[dict[str, Any]] = []
    for event in events:
        marker = _execution_marker_from_event(event)
        if marker is None:
            continue
        markers.append({"event_id": event.id, "sequence": event.sequence, **marker})
    replay_safe_markers = [marker for marker in markers if marker.get("replay_safe") is True]
    latest_execution_marker = markers[-1] if markers else None
    return {
        "latest_execution_marker": latest_execution_marker,
        "latest_replay_safe_marker": replay_safe_markers[-1] if replay_safe_markers else None,
        "latest_failure": _latest_runtime_failure(
            _latest_event(events, AGENT_RUN_FAILED),
            checkpoint=checkpoint,
            latest_execution_marker=latest_execution_marker,
        ),
        "latest_control": _latest_control_event(events),
        "latest_interruption": _latest_runtime_interruption(events),
        "latest_resume_diagnostic": _latest_resume_diagnostic(events),
        "latest_pending_call": _pending_runtime_call_summary(pending_call),
        "latest_pending_call_resolution": _pending_runtime_call_resolution_summary(pending_resolution),
        "automatic_resume_supported": False,
        "manual_restart_required": run.status == "failed" and checkpoint is None,
    }


def _execution_marker_from_event(event: AgentRunEvent) -> dict[str, Any] | None:
    if event.event_type != TOOL_TRACE:
        return None
    payload = event.payload if isinstance(event.payload, dict) else {}
    recovery = payload.get("recovery") if isinstance(payload.get("recovery"), dict) else None
    if recovery is None:
        return None
    return _execution_marker_summary(recovery)


def _execution_marker_summary(recovery: dict[str, Any]) -> dict[str, Any] | None:
    marker = recovery.get("execution_marker")
    if not isinstance(marker, dict):
        return None
    summary: dict[str, Any] = {}
    for key in ("kind", "source", "tool_name", "status", "resume_strategy", "reason"):
        value = marker.get(key)
        if isinstance(value, str) and value:
            summary[key] = value
    tool_index = marker.get("tool_index")
    if isinstance(tool_index, int):
        summary["tool_index"] = tool_index
    replay_safe = marker.get("replay_safe")
    if isinstance(replay_safe, bool):
        summary["replay_safe"] = replay_safe
    return summary or None


def _latest_runtime_interruption(events: list[AgentRunEvent]) -> dict[str, Any] | None:
    for event in reversed(events):
        if event.event_type not in {PAUSE_RUN, STOP_RUN}:
            continue
        status = "paused" if event.event_type == PAUSE_RUN else "stopped"
        return {
            "event_id": event.id,
            "sequence": event.sequence,
            "event_type": event.event_type,
            "status": status,
            "resume_strategy": "await_resume" if status == "paused" else "stopped_by_user",
            "automatic_resume_supported": False,
        }
    return None


def _latest_control_event(events: list[AgentRunEvent]) -> dict[str, Any] | None:
    for event in reversed(events):
        if event.event_type not in {PERMISSION_APPROVED, PERMISSION_DENIED, PAUSE_RUN, RESUME_RUN, STOP_RUN, RETRY_FROM_CHECKPOINT}:
            continue
        summary = {
            "event_id": event.id,
            "sequence": event.sequence,
            "event_type": event.event_type,
            **_control_event_summary(event),
        }
        return summary
    return None


def _latest_runtime_failure(
    event: AgentRunEvent | None,
    *,
    checkpoint: AgentArtifact | None,
    latest_execution_marker: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if event is None:
        return None
    failed_without_checkpoint = checkpoint is None
    summary: dict[str, Any] = {
        "event_id": event.id,
        "sequence": event.sequence,
        "event_type": event.event_type,
        "failed_without_checkpoint": failed_without_checkpoint,
        "manual_restart_required": failed_without_checkpoint,
        "resume_strategy": "manual_restart_required" if failed_without_checkpoint else "bookrun_checkpoint",
    }
    if event.message:
        summary["message"] = event.message[:500]
    if checkpoint is not None:
        summary["checkpoint_artifact_id"] = checkpoint.id
    if latest_execution_marker is not None:
        summary["latest_execution_marker"] = _runtime_marker_reference(latest_execution_marker)
    return summary


def _runtime_marker_reference(marker: dict[str, Any]) -> dict[str, Any]:
    reference: dict[str, Any] = {}
    for key in ("event_id", "sequence", "kind", "tool_name", "status", "resume_strategy", "reason"):
        value = marker.get(key)
        if isinstance(value, str | int):
            reference[key] = value
    replay_safe = marker.get("replay_safe")
    if isinstance(replay_safe, bool):
        reference["replay_safe"] = replay_safe
    tool_index = marker.get("tool_index")
    if isinstance(tool_index, int):
        reference["tool_index"] = tool_index
    return reference


def _latest_resume_diagnostic(events: list[AgentRunEvent]) -> dict[str, Any] | None:
    for event in reversed(events):
        if event.event_type != RESUME_RUN:
            continue
        payload = event.payload if isinstance(event.payload, dict) else {}
        recovery = payload.get("runtime_recovery") if isinstance(payload.get("runtime_recovery"), dict) else {}
        diagnostic = recovery.get("resume_diagnostic") if isinstance(recovery.get("resume_diagnostic"), dict) else None
        summary = _resume_diagnostic_summary(diagnostic)
        if summary is not None:
            return {"event_id": event.id, "sequence": event.sequence, "event_type": event.event_type, **summary}
    return None


def _resume_diagnostic_summary(diagnostic: dict[str, Any] | None) -> dict[str, Any] | None:
    if diagnostic is None:
        return None
    summary: dict[str, Any] = {}
    for key in (
        "kind",
        "reason",
        "intent",
        "boundary",
        "status",
        "pending_tool",
        "resume_strategy",
        "pending_resume_strategy",
        "run_status",
        "current_step",
        "artifact_kind",
    ):
        value = diagnostic.get(key)
        if isinstance(value, str) and value:
            summary[key] = value
    for key in ("artifact_id", "next_trace_index"):
        value = diagnostic.get(key)
        if isinstance(value, int):
            summary[key] = value
    for key in ("can_resume", "resume_via_control_channel", "requires_manual_restart"):
        value = diagnostic.get(key)
        if isinstance(value, bool):
            summary[key] = value
    return summary or None


def _is_pending_runtime_call(artifact: AgentArtifact | None) -> bool:
    if artifact is None or artifact.kind != RUNTIME_PENDING_CALL_ARTIFACT_KIND:
        return False
    return build_runtime_pending_call_summary(
        artifact.payload,
        artifact_id=artifact.id,
        artifact_kind=artifact.kind,
    ) is not None


def _pending_runtime_tool(artifact: AgentArtifact | None) -> str | None:
    summary = _pending_runtime_call_summary(artifact)
    if summary is None:
        return None
    pending_tool = summary.get("pending_tool")
    return pending_tool if isinstance(pending_tool, str) else None


def _pending_runtime_call_summary(artifact: AgentArtifact | None) -> dict[str, Any] | None:
    if not _is_pending_runtime_call(artifact):
        return None
    assert artifact is not None  # narrowed by _is_pending_runtime_call
    return build_runtime_pending_call_summary(
        artifact.payload,
        artifact_id=artifact.id,
        artifact_kind=artifact.kind,
    )


def _pending_runtime_call_resolution_summary(artifact: AgentArtifact | None) -> dict[str, Any] | None:
    if artifact is None or artifact.kind != RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND:
        return None
    payload = artifact.payload if isinstance(artifact.payload, dict) else {}
    summary: dict[str, Any] = {
        "artifact_id": artifact.id,
        "artifact_kind": artifact.kind,
    }
    for key in (
        "status",
        "resolution",
        "resolved_by",
        "result_status",
        "intent",
        "boundary",
        "pending_tool",
        "pending_resume_strategy",
    ):
        value = payload.get(key)
        if isinstance(value, str) and value:
            summary[key] = value
    pending_artifact_id = payload.get("pending_artifact_id")
    if isinstance(pending_artifact_id, int):
        summary["pending_artifact_id"] = pending_artifact_id
    next_trace_index = payload.get("next_trace_index")
    if isinstance(next_trace_index, int):
        summary["next_trace_index"] = next_trace_index
    return summary
