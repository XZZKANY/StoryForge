from __future__ import annotations

import json
from typing import Any

from app.domains.agent_runs.event_types import (
    AGENT_PLAN_CREATED,
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    AGENT_RUN_STARTED,
    PERMISSION_REQUIRED,
    TOOL_TRACE,
)
from app.domains.agent_runs.models import AgentRun, AgentRunEvent


def encode_agent_run_sse_event(event: AgentRunEvent) -> str:
    data = {
        "id": event.id,
        "run_id": event.run_id,
        "event_type": event.event_type,
        "actor": event.actor,
        "message": event.message,
        "payload": event.payload,
        "sequence": event.sequence,
        "created_at": event.created_at.isoformat(),
    }
    return f"event: {event.event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def websocket_started_event(run: AgentRun, event: AgentRunEvent) -> dict[str, Any]:
    scope = run.scope if isinstance(run.scope, dict) else {}
    return {
        "type": AGENT_RUN_STARTED,
        "session_id": run.session_id,
        "run_id": run.public_id,
        "user_message": run.goal,
        "event_id": event.id,
        "agent_role_hints": _scope_string_list(scope, "agent_role_hints"),
        "agent_role_mentions": _scope_string_list(scope, "agent_role_mentions"),
    }


def websocket_stream_events_from_agent_event(event: AgentRunEvent) -> list[dict[str, Any]]:
    """Encode durable AgentRunEvent rows into IDE WebSocket stream messages."""

    run = event.run
    if event.event_type == AGENT_RUN_STARTED:
        return [websocket_started_event(run, event)]
    if event.event_type == AGENT_PLAN_CREATED:
        return _websocket_agent_step_events(run, event)
    if event.event_type == TOOL_TRACE:
        return [_websocket_tool_trace_event(run, event)]
    if event.event_type == PERMISSION_REQUIRED:
        return [_websocket_permission_required_event(run, event)]
    if event.event_type in (AGENT_RUN_COMPLETED, AGENT_RUN_FAILED):
        return [_websocket_terminal_event(run, event)]
    return []


def websocket_control_event(event: AgentRunEvent) -> dict[str, Any]:
    return {
        "type": event.event_type,
        "session_id": str(event.payload.get("session_id") or ""),
        "run_id": str(event.payload.get("run_id") or ""),
        "event_id": event.id,
        "status": "recorded",
    }


def _scope_string_list(scope: dict[str, Any] | None, key: str) -> list[str]:
    if not isinstance(scope, dict):
        return []
    value = scope.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _websocket_agent_step_events(run: AgentRun, event: AgentRunEvent) -> list[dict[str, Any]]:
    payload = event.payload if isinstance(event.payload, dict) else {}
    plan = payload.get("plan") if isinstance(payload.get("plan"), list) else []
    events: list[dict[str, Any]] = []
    for index, step in enumerate(plan):
        if not isinstance(step, dict):
            continue
        events.append(
            {
                "type": "agent_step",
                "session_id": run.session_id,
                "run_id": run.public_id,
                "assistant_session_id": run.assistant_session_id,
                "event_id": event.id,
                "sequence": event.sequence,
                "index": index,
                "step": step.get("step"),
                "detail": step.get("detail"),
                "status": step.get("status"),
            }
        )
    return events


def _websocket_tool_trace_event(run: AgentRun, event: AgentRunEvent) -> dict[str, Any]:
    payload = event.payload if isinstance(event.payload, dict) else {}
    index = payload.get("index") if isinstance(payload.get("index"), int) else 0
    trace = payload.get("trace") if isinstance(payload.get("trace"), dict) else {}
    return {
        "type": TOOL_TRACE,
        "session_id": run.session_id,
        "run_id": run.public_id,
        "assistant_session_id": run.assistant_session_id,
        "event_id": event.id,
        "sequence": event.sequence,
        "index": index,
        "trace": trace,
    }


def _websocket_permission_required_event(run: AgentRun, event: AgentRunEvent) -> dict[str, Any]:
    payload = event.payload if isinstance(event.payload, dict) else {}
    return {
        "type": PERMISSION_REQUIRED,
        "session_id": run.session_id,
        "run_id": run.public_id,
        "assistant_session_id": run.assistant_session_id,
        "event_id": event.id,
        "sequence": event.sequence,
        "permission_profile": payload.get("permission_profile") or run.permission_profile,
        "reason": payload.get("reason") or "requires_user_confirmation",
        "proposed_patch": payload.get("proposed_patch") if isinstance(payload.get("proposed_patch"), dict) else None,
        "confirmation_action": payload.get("confirmation_action"),
        "blocked_tool": payload.get("blocked_tool"),
    }


def _websocket_terminal_event(run: AgentRun, event: AgentRunEvent) -> dict[str, Any]:
    """把 AGENT_RUN_COMPLETED/FAILED 落进 WS 流：断线后前端拉事件表重放即可重建终态（F10）。
    happy-path 前端仍据 agent_result（_STREAM_RESULT）settle，这里是重建路径的幂等补充。"""

    payload = event.payload if isinstance(event.payload, dict) else {}
    completed = event.event_type == AGENT_RUN_COMPLETED
    return {
        "type": "agent_run_completed" if completed else "agent_run_failed",
        "session_id": run.session_id,
        "run_id": run.public_id,
        "assistant_session_id": run.assistant_session_id,
        "event_id": event.id,
        "sequence": event.sequence,
        "status": run.status,
        "message": event.message,
        "payload": payload,
    }
