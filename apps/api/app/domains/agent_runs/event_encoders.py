from __future__ import annotations

import json
from typing import Any

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
        "type": "agent_run_started",
        "session_id": run.session_id,
        "run_id": run.public_id,
        "user_message": run.goal,
        "event_id": event.id,
        "agent_role_hints": _scope_string_list(scope, "agent_role_hints"),
        "agent_role_mentions": _scope_string_list(scope, "agent_role_mentions"),
    }


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
