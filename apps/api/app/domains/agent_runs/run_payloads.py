from __future__ import annotations

from typing import Any

from app.domains.agent_runs.event_types import (
    APPROVE_PERMISSION_COMMAND,
    DENY_PERMISSION_COMMAND,
    PAUSE_RUN,
    RESUME_RUN,
    RETRY_FROM_CHECKPOINT,
    STOP_RUN,
    event_type_for_control_message,
)
from app.domains.agent_runs.loop.author_view import AuthorView, author_view_summary
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.role_catalog import normalize_agent_role_inputs


def _message_text(message: dict[str, Any]) -> str:
    for key in ("user_message", "message", "content"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "Agent 用户请求"


def _message_input_summary(message: dict[str, Any]) -> dict[str, Any]:
    args = message.get("args") if isinstance(message.get("args"), dict) else {}
    summary: dict[str, Any] = {
        "type": message.get("type"),
        "intent": message.get("intent"),
        "has_args": bool(args),
    }
    for key in ("file_path", "scene_packet_id", "book_id", "blueprint_id", "book_run_id", "assistant_session_id"):
        value = args.get(key) if key in args else message.get(key)
        if value is not None:
            summary[key] = value
    content = args.get("content")
    if isinstance(content, str):
        summary["content_chars"] = len(content)
    if isinstance(args.get("author_view"), dict):
        # 只落形状与量：选区 / 光标窗正文不进事件表（事件表会被导出与展示）。
        summary["author_view"] = author_view_summary(AuthorView.from_payload(args))
    return summary


def _scope_summary(args: dict[str, Any]) -> dict[str, Any]:
    scope: dict[str, Any] = {}
    for key in ("file_path", "scene_packet_id", "book_id", "blueprint_id", "book_run_id", "project_name"):
        value = args.get(key)
        if isinstance(value, str | int):
            scope[key] = value
    role_inputs = normalize_agent_role_inputs(args)
    if role_inputs.hints:
        scope["agent_role_hints"] = role_inputs.hints
    if role_inputs.mentions:
        scope["agent_role_mentions"] = role_inputs.mentions
    if role_inputs.unknown_hints:
        scope["unknown_agent_role_hints"] = role_inputs.unknown_hints
    if role_inputs.unknown_mentions:
        scope["unknown_agent_role_mentions"] = role_inputs.unknown_mentions
    return scope


def _has_scope_key(scope: dict[str, Any] | None, *keys: str) -> bool:
    if not isinstance(scope, dict):
        return False
    return any(scope.get(key) is not None for key in keys)


def _scope_string_list(scope: dict[str, Any] | None, key: str) -> list[str]:
    if not isinstance(scope, dict):
        return []
    value = scope.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _budget_summary(args: dict[str, Any]) -> dict[str, Any]:
    budget: dict[str, Any] = {}
    for key in ("token_budget", "time_budget_sec", "chapter_budget"):
        value = args.get(key)
        if isinstance(value, int) and value > 0:
            budget[key] = value
    return budget


def _current_plan_step(plan: list[Any]) -> str | None:
    for step in plan:
        if not isinstance(step, dict):
            continue
        status = step.get("status")
        if status not in {"completed", "skipped"}:
            value = step.get("step")
            return str(value) if value is not None else None
    if plan:
        last = plan[-1]
        if isinstance(last, dict) and last.get("step") is not None:
            return str(last["step"])
    return None


def _optional_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and value > 0 else None


def _has_event(run: AgentRun, event_type: str) -> bool:
    return any(event.event_type == event_type for event in run.events)


def _control_event_type(control_type: str) -> str:
    return event_type_for_control_message(control_type)


def _control_event_message(control_type: str) -> str:
    messages = {
        APPROVE_PERMISSION_COMMAND: "作者已批准权限请求。",
        DENY_PERMISSION_COMMAND: "作者已拒绝权限请求。",
        PAUSE_RUN: "作者已暂停 AgentRun。",
        RESUME_RUN: "作者已恢复 AgentRun。",
        STOP_RUN: "作者已停止 AgentRun。",
        RETRY_FROM_CHECKPOINT: "作者要求从 checkpoint 重试 AgentRun。",
    }
    return messages.get(control_type, f"收到控制消息：{control_type}")


message_text = _message_text
message_input_summary = _message_input_summary
scope_summary = _scope_summary
has_scope_key = _has_scope_key
scope_string_list = _scope_string_list
budget_summary = _budget_summary
current_plan_step = _current_plan_step
optional_string = _optional_string
optional_positive_int = _optional_positive_int
has_event = _has_event
control_event_type = _control_event_type
control_event_message = _control_event_message
