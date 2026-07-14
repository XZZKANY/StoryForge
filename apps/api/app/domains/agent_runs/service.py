from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs import run_payloads, skill_catalog
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.event_encoders import (
    encode_agent_run_sse_event,
    websocket_control_event,
    websocket_started_event,
    websocket_stream_events_from_agent_event,
)
from app.domains.agent_runs.event_sink import AgentRunEventSink
from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.domains.agent_runs.role_catalog import (
    get_agent_role as _catalog_get_agent_role,
)
from app.domains.agent_runs.role_catalog import (
    is_role_allowed_tool as _catalog_is_role_allowed_tool,
)
from app.domains.agent_runs.role_catalog import (
    list_agent_roles as _catalog_list_agent_roles,
)
from app.domains.agent_runs.role_catalog import (
    list_subagent_roles as _catalog_list_subagent_roles,
)
from app.domains.agent_runs.role_catalog import (
    resolve_agent_role_alias as _catalog_resolve_agent_role_alias,
)
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.schemas import AgentRoleRead
from app.domains.agent_runs.service_bookrun_bridge import (
    apply_book_run_control_if_needed as _apply_book_run_control_if_needed,
)
from app.domains.agent_runs.service_bookrun_bridge import (
    record_book_run_snapshot,
)
from app.domains.agent_runs.service_control import (
    handle_agent_control_message as _handle_agent_control_message,
)
from app.domains.agent_runs.service_control import (
    record_agent_control_event,
)
from app.domains.agent_runs.service_control import (
    resume_agent_run_if_pending as _resume_agent_run_if_pending,
)
from app.domains.agent_runs.service_lifecycle import (
    create_or_resume_agent_run,
    create_or_resume_bookrun_agent_run,
    start_agent_user_message_run,
)
from app.domains.agent_runs.service_store import (
    complete_agent_run,
    fail_agent_run,
    get_agent_run,
    get_agent_run_save_points,
    list_agent_artifacts,
    list_agent_checkpoints,
    list_agent_run_events,
    reap_non_terminal_agent_runs,
    record_agent_artifact,
    record_agent_event,
    record_subagent_run,
)
from app.domains.agent_runs.service_store import (
    completed_event_payload as _completed_event_payload,
)
from app.domains.agent_runs.service_store import (
    list_agent_save_point_artifacts as _list_agent_save_point_artifacts,
)
from app.domains.agent_runs.service_types import (
    AGENT_RUN_REAP_PRESERVED_STATUSES,
    AGENT_RUN_TERMINAL_STATUSES,
    AgentControlResult,
    AgentRunNotFoundError,
    AgentRunStartResult,
    AgentRuntimeError,
    AgentRuntimeUserMessageError,
    AgentRuntimeUserMessageResult,
)

_AgentRunEventSink = AgentRunEventSink
_book_run_budget = run_payloads.book_run_budget
_book_run_id_from_result = run_payloads.book_run_id_from_result
_book_run_snapshot_payload = run_payloads.book_run_snapshot_payload
_budget_summary = run_payloads.budget_summary
_control_event_message = run_payloads.control_event_message
_control_event_type = run_payloads.control_event_type
_current_plan_step = run_payloads.current_plan_step
_has_event = run_payloads.has_event
_has_scope_key = run_payloads.has_scope_key
_message_input_summary = run_payloads.message_input_summary
_message_text = run_payloads.message_text
_optional_positive_int = run_payloads.optional_positive_int
_optional_string = run_payloads.optional_string
_scope_string_list = run_payloads.scope_string_list
_scope_summary = run_payloads.scope_summary
_AGENT_SKILL_DEFINITIONS = skill_catalog.AGENT_SKILL_DEFINITIONS
_agent_plan_payload = skill_catalog.agent_plan_payload
_skill_by_name = skill_catalog.skill_by_name
list_agent_skills = skill_catalog.list_agent_skills

__all__ = [
    "_AGENT_SKILL_DEFINITIONS",
    "_AgentRunEventSink",
    "_agent_plan_payload",
    "_apply_book_run_control_if_needed",
    "_book_run_budget",
    "_book_run_id_from_result",
    "_book_run_snapshot_payload",
    "_budget_summary",
    "_completed_event_payload",
    "_control_event_message",
    "_control_event_type",
    "_current_plan_step",
    "_has_event",
    "_has_scope_key",
    "_list_agent_save_point_artifacts",
    "_message_input_summary",
    "_message_text",
    "_optional_positive_int",
    "_optional_string",
    "_scope_string_list",
    "_scope_summary",
    "_skill_by_name",
    "AGENT_RUN_REAP_PRESERVED_STATUSES",
    "AGENT_RUN_TERMINAL_STATUSES",
    "AgentControlResult",
    "AgentRuntime",
    "AgentRunNotFoundError",
    "AgentRunStartResult",
    "AgentRuntimeError",
    "AgentRuntimeUserMessageError",
    "AgentRuntimeUserMessageResult",
    "complete_agent_run",
    "create_or_resume_agent_run",
    "create_or_resume_bookrun_agent_run",
    "encode_agent_run_sse_event",
    "execute_agent_user_message_run",
    "fail_agent_run",
    "get_agent_role",
    "get_agent_run",
    "get_agent_run_save_points",
    "handle_agent_control_message",
    "is_role_allowed_tool",
    "list_agent_artifacts",
    "list_agent_checkpoints",
    "list_agent_roles",
    "list_agent_run_events",
    "list_agent_skills",
    "list_subagent_roles",
    "reap_non_terminal_agent_runs",
    "record_agent_artifact",
    "record_agent_control_event",
    "record_agent_event",
    "record_book_run_snapshot",
    "record_subagent_run",
    "resolve_agent_role_alias",
    "resume_agent_run_if_pending",
    "run_agent_user_message",
    "start_agent_user_message_run",
    "websocket_control_event",
    "websocket_started_event",
    "websocket_stream_events_from_agent_event",
]


def execute_agent_user_message_run(
    session: Session,
    *,
    run: AgentRun,
    agent_session_id: str,
    message: dict[str, Any],
    on_event: Callable[[AgentRunEvent], None] | None = None,
) -> dict[str, Any]:
    """由 Agent Runtime 作为唯一入口驱动 skill、tools、permission 和事件写入。"""

    try:
        runtime = AgentRuntime(_AgentRunEventSink(session, on_event=on_event))
    except AgentOrchestrationError as exc:
        fail_agent_run(
            session,
            run,
            message=str(exc),
            payload={"session_id": agent_session_id, "run_id": run.public_id, "runtime": "agent_runtime"},
        )
        raise AgentRuntimeError(str(exc)) from exc
    try:
        return runtime.run_user_message(
            session,
            run=run,
            agent_session_id=agent_session_id,
            message=message,
        )
    except AgentOrchestrationError as exc:
        raise AgentRuntimeError(str(exc)) from exc


def run_agent_user_message(
    session: Session,
    *,
    agent_session_id: str,
    message: dict[str, Any],
    on_event: Callable[[AgentRunEvent], None] | None = None,
) -> AgentRuntimeUserMessageResult:
    """Agent Runtime Facade：SSE user_message 的唯一执行入口。"""

    start = start_agent_user_message_run(session, agent_session_id=agent_session_id, message=message)
    if on_event is not None:
        on_event(start.started_event)
    run_id = start.run.public_id
    try:
        result = execute_agent_user_message_run(
            session,
            run=start.run,
            agent_session_id=agent_session_id,
            message={**message, "run_id": run_id},
            on_event=on_event,
        )
    except AgentRuntimeError as exc:
        raise AgentRuntimeUserMessageError(str(exc), run=start.run, started_event=start.started_event) from exc
    result["run_id"] = run_id
    return AgentRuntimeUserMessageResult(run=start.run, started_event=start.started_event, result=result)


def handle_agent_control_message(
    session: Session,
    *,
    public_id: str,
    session_id: str,
    control_type: str,
    payload: dict[str, Any] | None = None,
) -> AgentControlResult:
    return _handle_agent_control_message(
        session,
        public_id=public_id,
        session_id=session_id,
        control_type=control_type,
        payload=payload,
        execute_run=execute_agent_user_message_run,
    )


def resume_agent_run_if_pending(
    session: Session,
    *,
    public_id: str,
    agent_session_id: str,
) -> dict[str, Any] | None:
    return _resume_agent_run_if_pending(
        session,
        public_id=public_id,
        agent_session_id=agent_session_id,
        execute_run=execute_agent_user_message_run,
    )


def list_agent_roles() -> list[AgentRoleRead]:
    """返回 Agent Runtime 只读角色目录。"""

    return _catalog_list_agent_roles()


def get_agent_role(name: str) -> AgentRoleRead | None:
    """按规范 role name 读取目录中的 role。"""

    return _catalog_get_agent_role(name)


def list_subagent_roles() -> list[AgentRoleRead]:
    """返回可被 Runtime 调度的 subagent roles。"""

    return _catalog_list_subagent_roles()


def is_role_allowed_tool(role_name: str, tool_name: str) -> bool:
    """校验某个 role 是否允许调用对应 runtime tool。"""

    return _catalog_is_role_allowed_tool(role_name, tool_name)


def resolve_agent_role_alias(alias: str) -> AgentRoleRead | None:
    """根据用户输入的 @角色 alias 解析到目录中的 role。"""

    return _catalog_resolve_agent_role_alias(alias)


def _validate_agent_role_catalog() -> None:
    _catalog_list_agent_roles()
