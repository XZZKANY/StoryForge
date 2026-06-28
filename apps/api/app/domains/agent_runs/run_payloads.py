from __future__ import annotations

from typing import Any

from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.role_catalog import normalize_agent_role_inputs
from app.domains.book_runs.models import BookRun
from app.domains.writing_runs.service import full_book_writing_run_event_data


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
    if control_type == "approve_permission":
        return "permission_approved"
    if control_type == "deny_permission":
        return "permission_denied"
    return control_type


def _control_event_message(control_type: str) -> str:
    messages = {
        "approve_permission": "作者已批准权限请求。",
        "deny_permission": "作者已拒绝权限请求。",
        "pause_run": "作者已暂停 AgentRun。",
        "resume_run": "作者已恢复 AgentRun。",
        "stop_run": "作者已停止 AgentRun。",
        "retry_from_checkpoint": "作者要求从 checkpoint 重试 AgentRun。",
    }
    return messages.get(control_type, f"收到控制消息：{control_type}")


def _book_run_id_from_result(result: dict[str, Any]) -> int | None:
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    book_run_id = _optional_positive_int(agent_result.get("book_run_id"))
    if book_run_id is not None:
        return book_run_id
    book_run = agent_result.get("book_run")
    if isinstance(book_run, dict):
        return _optional_positive_int(book_run.get("id"))
    return None


def _book_run_budget(book_run: BookRun) -> dict[str, Any]:
    budget: dict[str, Any] = {}
    if book_run.token_budget is not None:
        budget["token_budget"] = book_run.token_budget
    if book_run.time_budget_sec is not None:
        budget["time_budget_sec"] = book_run.time_budget_sec
    if book_run.chapter_budget is not None:
        budget["chapter_budget"] = book_run.chapter_budget
    return budget


def _book_run_snapshot_payload(book_run: BookRun, *, source: str) -> dict[str, Any]:
    completed = [item for item in (book_run.progress or {}).get("completed_chapters", []) if isinstance(item, dict)]
    return {
        **full_book_writing_run_event_data(book_run.id, book_run.status),
        "source": source,
        "book_id": book_run.book_id,
        "blueprint_id": book_run.blueprint_id,
        "current_chapter_index": book_run.current_chapter_index,
        "total_chapters": book_run.total_chapters,
        "completed_count": len(completed),
        "tokens_used": book_run.tokens_used,
        "token_budget": book_run.token_budget,
        "checkpoint_count": len(book_run.checkpoint or []),
    }
