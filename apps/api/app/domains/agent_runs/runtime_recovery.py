from __future__ import annotations

from typing import Any

from app.domains.agent_runs.tools import AgentRuntimeToolSpec
from app.domains.agent_runs.trace import AgentToolTrace

INTERRUPTIBLE_RUN_STATUSES = frozenset({"paused", "stopped"})
RUNTIME_PENDING_CALL_ARTIFACT_KIND = "runtime_pending_call"
RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND = "runtime_pending_call_resolution"
SUPPORTED_RUNTIME_PENDING_CALL_INTENTS = frozenset({"chapter.review", "file.review"})


def build_tool_recovery_payload(
    trace: AgentToolTrace,
    index: int,
    *,
    spec: AgentRuntimeToolSpec | None,
) -> dict[str, Any]:
    """Build the persisted recovery marker carried by a tool_trace event."""

    payload: dict[str, Any] = {
        "kind": "tool_completed",
        "tool_name": trace.tool_name,
        "status": trace.status,
        "index": index,
    }
    if spec is not None:
        payload.update(
            {
                "retry_safe": spec.retry_safe,
                "idempotent": spec.idempotent,
                "execution_mode": spec.execution_mode,
                "artifact_kinds": list(spec.artifact_kinds),
            }
        )
    payload["execution_marker"] = build_runtime_execution_marker(trace, index, spec=spec)
    return payload


def build_runtime_execution_marker(
    trace: AgentToolTrace,
    index: int,
    *,
    spec: AgentRuntimeToolSpec | None,
) -> dict[str, Any]:
    """Describe the durable boundary after a tool result has reached AgentRunEvent."""

    replay_safe = trace.status == "completed" and spec is not None and spec.retry_safe and spec.idempotent
    return {
        "kind": "after_tool",
        "source": "tool_trace",
        "tool_name": trace.tool_name,
        "tool_index": index,
        "status": trace.status,
        "replay_safe": replay_safe,
        "resume_strategy": "replay_from_tool_boundary" if replay_safe else "manual_restart_required",
        "reason": _marker_reason(trace, spec=spec, replay_safe=replay_safe),
    }


def _marker_reason(trace: AgentToolTrace, *, spec: AgentRuntimeToolSpec | None, replay_safe: bool) -> str:
    if trace.status != "completed":
        return "tool_not_completed"
    if replay_safe:
        return "retry_safe_idempotent_tool"
    if spec is None:
        return "unknown_tool_policy"
    return "tool_not_retry_safe"


def build_runtime_interruption_payload(run: object, *, boundary: str) -> dict[str, Any] | None:
    """Project the existing paused/stopped run state as a runtime interruption."""

    status = getattr(run, "status", None)
    if status not in INTERRUPTIBLE_RUN_STATUSES:
        return None
    current_step = getattr(run, "current_step", None)
    return {
        "kind": "runtime_interruption",
        "status": status,
        "current_step": current_step if isinstance(current_step, str) else None,
        "boundary": boundary,
        "uses_existing_status": True,
        "resume_strategy": "await_resume" if status == "paused" else "stopped_by_user",
        "automatic_resume_supported": False,
    }


def build_runtime_pending_call_summary(
    payload: object,
    *,
    artifact_id: int | None = None,
    artifact_kind: str | None = RUNTIME_PENDING_CALL_ARTIFACT_KIND,
) -> dict[str, Any] | None:
    """Return a safe, replayable summary for a pending runtime call artifact."""

    if not isinstance(payload, dict) or payload.get("status") != "pending":
        return None
    summary: dict[str, Any] = {}
    if artifact_id is not None:
        summary["artifact_id"] = artifact_id
    if isinstance(artifact_kind, str) and artifact_kind:
        summary["artifact_kind"] = artifact_kind
    for source_key, target_key in (
        ("intent", "intent"),
        ("boundary", "boundary"),
        ("status", "status"),
        ("resume_strategy", "resume_strategy"),
    ):
        value = payload.get(source_key)
        if isinstance(value, str) and value:
            summary[target_key] = value
    intent = summary.get("intent")
    if intent == "file.review":
        boundary = summary.get("boundary")
        summary["pending_tool"] = "file.review.postprocess" if boundary != "after_tool:context.load" else "file.review"
    elif intent == "chapter.review":
        summary["pending_tool"] = "chapter.review.postprocess"
    next_trace_index = payload.get("next_trace_index")
    if isinstance(next_trace_index, int):
        summary["next_trace_index"] = next_trace_index
    return summary


def build_runtime_pending_call_resume_diagnostic(
    *,
    run_status: object,
    current_step: object,
    payload: object,
    artifact_id: int | None = None,
    artifact_kind: str | None = RUNTIME_PENDING_CALL_ARTIFACT_KIND,
) -> dict[str, Any]:
    """Explain whether a pending runtime call can be resumed through control-channel resume."""

    summary = build_runtime_pending_call_summary(payload, artifact_id=artifact_id, artifact_kind=artifact_kind)
    diagnostic: dict[str, Any] = {
        "kind": "runtime_pending_call_resume",
        "can_resume": False,
        "resume_via_control_channel": False,
        "requires_manual_restart": True,
        "reason": "invalid_pending_call",
        "resume_strategy": "manual_restart_required",
    }
    if artifact_id is not None:
        diagnostic["artifact_id"] = artifact_id
    if isinstance(artifact_kind, str) and artifact_kind:
        diagnostic["artifact_kind"] = artifact_kind
    if isinstance(run_status, str):
        diagnostic["run_status"] = run_status
    if isinstance(current_step, str):
        diagnostic["current_step"] = current_step
    if summary is None:
        return diagnostic

    for key in ("intent", "boundary", "status", "pending_tool", "next_trace_index"):
        value = summary.get(key)
        if isinstance(value, str | int):
            diagnostic[key] = value
    pending_resume_strategy = summary.get("resume_strategy")
    if isinstance(pending_resume_strategy, str) and pending_resume_strategy:
        diagnostic["pending_resume_strategy"] = pending_resume_strategy

    intent = summary.get("intent")
    if intent not in SUPPORTED_RUNTIME_PENDING_CALL_INTENTS:
        diagnostic["reason"] = "unsupported_pending_call_intent"
        return diagnostic
    if run_status != "running" or current_step != "resumed":
        diagnostic["reason"] = "run_not_resumed"
        diagnostic["requires_manual_restart"] = False
        diagnostic["resume_strategy"] = "await_resume"
        return diagnostic
    resume_message = payload.get("resume_message") if isinstance(payload, dict) else None
    if not isinstance(resume_message, dict):
        diagnostic["reason"] = "missing_resume_message"
        return diagnostic
    if intent == "chapter.review":
        judge_output = payload.get("judge_output") if isinstance(payload, dict) else None
        judge_trace = payload.get("judge_trace") if isinstance(payload, dict) else None
        if not isinstance(judge_output, dict) or not isinstance(judge_trace, dict):
            diagnostic["reason"] = "missing_resume_payload"
            return diagnostic

    diagnostic["can_resume"] = True
    diagnostic["resume_via_control_channel"] = True
    diagnostic["requires_manual_restart"] = False
    diagnostic["reason"] = "pending_call_ready"
    diagnostic["resume_strategy"] = (
        pending_resume_strategy if isinstance(pending_resume_strategy, str) and pending_resume_strategy else "continue_pending_call"
    )
    return diagnostic


def build_runtime_pending_call_resolution_payload(
    payload: object,
    *,
    artifact_id: int,
    artifact_kind: str = RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    resolved_by: str = "agent_runtime",
    result_status: str = "completed",
) -> dict[str, Any]:
    """Build an append-only hidden artifact documenting a consumed pending call."""

    pending_call = build_runtime_pending_call_summary(payload, artifact_id=artifact_id, artifact_kind=artifact_kind)
    result: dict[str, Any] = {
        "kind": RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
        "status": "resolved",
        "resolution": "resumed",
        "resolved_by": resolved_by,
        "result_status": result_status,
        "pending_artifact_id": artifact_id,
        "pending_artifact_kind": artifact_kind,
    }
    if pending_call is not None:
        result["pending_call"] = pending_call
        for key in ("intent", "boundary", "pending_tool", "next_trace_index"):
            value = pending_call.get(key)
            if isinstance(value, str | int):
                result[key] = value
        resume_strategy = pending_call.get("resume_strategy")
        if isinstance(resume_strategy, str) and resume_strategy:
            result["pending_resume_strategy"] = resume_strategy
    return result
