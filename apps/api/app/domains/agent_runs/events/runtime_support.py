from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    build_runtime_pending_call_resolution_payload,
    build_runtime_pending_call_summary,
)
from app.domains.agent_runs.tools import ToolArtifact
from app.domains.agent_runs.tools.runtime_arguments import optional_positive_int as _optional_positive_int
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantSessionCreate


def _resolve_assistant_session(
    session: Session,
    *,
    user_message: str,
    message: dict[str, Any],
    args: dict[str, Any],
):
    requested_id = _optional_positive_int(message.get("assistant_session_id")) or _optional_positive_int(args.get("assistant_session_id"))
    if requested_id is not None:
        try:
            return assistant_service.get_assistant_session(session, requested_id)
        except assistant_service.AssistantSessionNotFoundError as exc:
            raise AgentOrchestrationError(str(exc)) from exc
    project_path = _optional_string(args.get("project_path")) or _optional_string(message.get("project_path"))
    return assistant_service.create_assistant_session(
        session,
        AssistantSessionCreate(
            title=f"IDE Agent: {user_message[:120]}",
            task_type="ide_agent_orchestration",
            project_path=project_path,
            messages=[],
        ),
    )


def _base_response(
    *,
    agent_session_id: str,
    assistant_session_id: int,
    intent: str,
    user_message: str,
    plan: list[dict[str, Any]],
    agent_result: dict[str, Any],
    tool_trace: list[AgentToolTrace],
    proposed_patch: dict[str, Any] | None = None,
    runtime_mode: str = "agent_runtime",
    role_hints: list[str] | None = None,
    role_mentions: list[str] | None = None,
    tool_artifacts: list[ToolArtifact] | None = None,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "type": "agent_result",
        "session_id": agent_session_id,
        "assistant_session_id": assistant_session_id,
        "intent": intent,
        "user_message": user_message,
        "agent_role_hints": role_hints or [],
        "agent_role_mentions": role_mentions or [],
        "plan": plan,
        "agent_result": agent_result,
        "tool_trace": [item.as_dict() for item in tool_trace],
        "proposed_patch": proposed_patch,
        "runtime_mode": runtime_mode,
    }
    if tool_artifacts:
        response["_tool_artifacts"] = tool_artifacts
    return response


def _trace_objects(result: dict[str, Any]) -> list[AgentToolTrace]:
    traces = result.get("tool_trace") if isinstance(result.get("tool_trace"), list) else []
    objects: list[AgentToolTrace] = []
    for trace in traces:
        if isinstance(trace, AgentToolTrace):
            objects.append(trace)
        elif isinstance(trace, dict):
            objects.append(
                AgentToolTrace(
                    tool_name=str(trace.get("tool_name") or "unknown"),
                    status=str(trace.get("status") or "completed"),
                    input_summary=trace.get("input_summary") if isinstance(trace.get("input_summary"), dict) else {},
                    output_summary=trace.get("output_summary") if isinstance(trace.get("output_summary"), dict) else None,
                    audit_event_id=trace.get("audit_event_id") if isinstance(trace.get("audit_event_id"), str) else None,
                    assistant_tool_call_id=trace.get("assistant_tool_call_id") if isinstance(trace.get("assistant_tool_call_id"), int) else None,
                    error_message=trace.get("error_message") if isinstance(trace.get("error_message"), str) else None,
                )
            )
    return objects


def _latest_runtime_pending_call(session: Session, run: AgentRun, *, intent: str | None = None) -> AgentArtifact | None:
    artifacts = list(
        session.scalars(
            select(AgentArtifact)
            .where(
                AgentArtifact.run_id == run.id,
                AgentArtifact.kind.in_(
                    {RUNTIME_PENDING_CALL_ARTIFACT_KIND, RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND}
                ),
            )
            .order_by(AgentArtifact.id.desc())
        )
    )
    for artifact in artifacts:
        if artifact.kind == RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND:
            return None
        summary = build_runtime_pending_call_summary(
            artifact.payload,
            artifact_id=artifact.id,
            artifact_kind=artifact.kind,
        )
        if summary is not None and (intent is None or summary.get("intent") == intent):
            return artifact
    return None


def _should_resume_file_review(run: AgentRun, pending_call: AgentArtifact | None) -> bool:
    return _should_resume_runtime_pending_call(run, pending_call)


def _should_resume_runtime_pending_call(run: AgentRun, pending_call: AgentArtifact | None) -> bool:
    return pending_call is not None and run.status == "running" and run.current_step == "resumed"


def _file_review_resume_message(result: dict[str, Any]) -> dict[str, Any]:
    context_trace = result["tool_trace"][0] if result.get("tool_trace") else {}
    input_summary = context_trace.get("input_summary") if isinstance(context_trace, dict) else {}
    file_path = input_summary.get("file_path") if isinstance(input_summary, dict) else None
    return {
        "type": "user_message",
        "run_id": result.get("run_id"),
        "user_message": result.get("user_message"),
        "intent": "file.review",
        "args": {
            "file_path": file_path if isinstance(file_path, str) else None,
            "agent_role_hints": result.get("agent_role_hints") if isinstance(result.get("agent_role_hints"), list) else [],
            "agent_role_mentions": result.get("agent_role_mentions")
            if isinstance(result.get("agent_role_mentions"), list)
            else [],
        },
    }


def _chapter_review_resume_message(result: dict[str, Any], *, scene_packet_id: int) -> dict[str, Any]:
    return {
        "type": "user_message",
        "run_id": result.get("run_id"),
        "user_message": result.get("user_message"),
        "intent": "chapter.review",
        "args": {
            "scene_packet_id": scene_packet_id,
            "agent_role_hints": result.get("agent_role_hints") if isinstance(result.get("agent_role_hints"), list) else [],
            "agent_role_mentions": result.get("agent_role_mentions")
            if isinstance(result.get("agent_role_mentions"), list)
            else [],
        },
    }


def _runtime_pending_call_resolution_artifact(pending_call: AgentArtifact) -> ToolArtifact:
    return ToolArtifact(
        kind=RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
        payload=build_runtime_pending_call_resolution_payload(
            pending_call.payload,
            artifact_id=pending_call.id,
            artifact_kind=pending_call.kind,
        ),
        requires_confirmation=False,
    )


def _json_safe_review_output(review_output: dict[str, Any]) -> dict[str, Any]:
    traces = review_output.get("traces") if isinstance(review_output.get("traces"), list) else []
    return {
        **review_output,
        "traces": [trace.as_dict() if isinstance(trace, AgentToolTrace) else trace for trace in traces],
    }


def _tool_artifacts_from_result(result: dict[str, Any]) -> list[ToolArtifact]:
    raw_artifacts = result.pop("_tool_artifacts", None)
    if not isinstance(raw_artifacts, list):
        return []
    artifacts: list[ToolArtifact] = []
    for item in raw_artifacts:
        if isinstance(item, ToolArtifact):
            artifacts.append(item)
        elif isinstance(item, dict):
            kind = item.get("kind")
            payload = item.get("payload")
            if isinstance(kind, str) and kind and isinstance(payload, dict):
                artifacts.append(
                    ToolArtifact(
                        kind=kind,
                        payload=payload,
                        requires_confirmation=bool(item.get("requires_confirmation")),
                    )
                )
    return artifacts


def _result_requires_confirmation(result: dict[str, Any]) -> bool:
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    proposed_patch = result.get("proposed_patch") if isinstance(result.get("proposed_patch"), dict) else None
    return bool(
        agent_result.get("requires_user_confirmation")
        or agent_result.get("confirmation_required")
        or (proposed_patch and proposed_patch.get("requires_confirmation"))
    )


def _runtime_interrupted_response(
    result: dict[str, Any],
    interruption: dict[str, Any],
    *,
    events_recorded: bool = False,
) -> dict[str, Any]:
    agent_result = result.setdefault("agent_result", {})
    if not isinstance(agent_result, dict):
        agent_result = {}
        result["agent_result"] = agent_result
    agent_result["summary"] = _runtime_interruption_summary(interruption)
    agent_result["requires_user_confirmation"] = False
    agent_result["runtime_interrupted"] = True
    result["runtime_interruption"] = interruption
    result["_runtime_interrupted"] = True
    if events_recorded:
        result["_events_recorded"] = True
    return result


def _runtime_interruption_summary(interruption: dict[str, Any]) -> str:
    status = interruption.get("status")
    boundary = interruption.get("boundary")
    if status == "paused":
        return f"AgentRun 已在 {boundary} 边界暂停，等待继续指令。"
    if status == "stopped":
        return f"AgentRun 已在 {boundary} 边界停止。"
    return f"AgentRun 已在 {boundary} 边界中断。"


def _pop_runtime_internal_markers(result: dict[str, Any]) -> None:
    result.pop("_events_recorded", None)
    result.pop("_runtime_interrupted", None)
    result.pop("_tool_artifacts", None)


def _plan_step(step: str, detail: str, status: str) -> dict[str, str]:
    return {"step": step, "detail": detail, "status": status}


resolve_assistant_session = _resolve_assistant_session
base_response = _base_response
trace_objects = _trace_objects
latest_runtime_pending_call = _latest_runtime_pending_call
should_resume_file_review = _should_resume_file_review
should_resume_runtime_pending_call = _should_resume_runtime_pending_call
file_review_resume_message = _file_review_resume_message
chapter_review_resume_message = _chapter_review_resume_message
runtime_pending_call_resolution_artifact = _runtime_pending_call_resolution_artifact
json_safe_review_output = _json_safe_review_output
tool_artifacts_from_result = _tool_artifacts_from_result
result_requires_confirmation = _result_requires_confirmation
runtime_interrupted_response = _runtime_interrupted_response
runtime_interruption_summary = _runtime_interruption_summary
pop_runtime_internal_markers = _pop_runtime_internal_markers
plan_step = _plan_step
