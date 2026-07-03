from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.common.exceptions import NotFoundError
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.event_encoders import (  # noqa: F401  facade re-export
    encode_agent_run_sse_event,
    websocket_control_event,
    websocket_started_event,
    websocket_stream_events_from_agent_event,
)
from app.domains.agent_runs.event_sink import (  # noqa: F401  facade re-export
    _AgentRunEventSink,
)
from app.domains.agent_runs.event_types import (
    AGENT_ARTIFACT,
    AGENT_PLAN_CREATED,
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    AGENT_RUN_STARTED,
    APPROVE_PERMISSION_COMMAND,
    DENY_PERMISSION_COMMAND,
    PAUSE_RUN,
    RESUME_RUN,
    RETRY_FROM_CHECKPOINT,
    STOP_RUN,
    TOOL_TRACE,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
from app.domains.agent_runs.role_catalog import (
    DEFAULT_PERMISSION_PROFILE,
    normalize_agent_role_inputs,
)
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
from app.domains.agent_runs.run_payloads import (  # noqa: F401  facade re-export
    _book_run_budget,
    _book_run_id_from_result,
    _book_run_snapshot_payload,
    _budget_summary,
    _control_event_message,
    _control_event_type,
    _current_plan_step,
    _has_event,
    _has_scope_key,
    _message_input_summary,
    _message_text,
    _optional_positive_int,
    _optional_string,
    _scope_string_list,
    _scope_summary,
)
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    build_runtime_pending_call_resume_diagnostic,
    build_runtime_pending_call_summary,
)
from app.domains.agent_runs.save_points import build_agent_run_save_point_projection
from app.domains.agent_runs.schemas import AgentRoleRead
from app.domains.agent_runs.skill_catalog import (  # noqa: F401  facade re-export
    _AGENT_SKILL_DEFINITIONS,
    _agent_plan_payload,
    _skill_by_name,
    list_agent_skills,
)
from app.domains.agent_runs.system_jobs import HIDDEN_SYSTEM_ARTIFACT_KINDS
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.service import (
    BookRunBlockedError,
    BookRunNotFoundError,
)
from app.domains.writing_runs.service import (
    full_book_writing_run_event_data,
    pause_writing_run,
    resume_writing_run,
    retry_writing_run_from_checkpoint,
    stop_writing_run,
    writing_run_payload,
)

AGENT_RUN_TERMINAL_STATUSES = frozenset({"completed", "failed", "stopped"})


class AgentRunNotFoundError(NotFoundError):
    """AgentRun 不存在。"""


class AgentRuntimeError(RuntimeError):
    """Agent Runtime 包装下游编排失败。"""


class AgentRuntimeUserMessageError(AgentRuntimeError):
    """user_message facade 失败，但已创建 AgentRun，可用于 WebSocket 回传 run_id。"""

    def __init__(self, detail: str, *, run: AgentRun, started_event: AgentRunEvent) -> None:
        super().__init__(detail)
        self.run = run
        self.started_event = started_event


@dataclass(frozen=True)
class AgentRunStartResult:
    run: AgentRun
    started_event: AgentRunEvent


@dataclass(frozen=True)
class AgentRuntimeUserMessageResult:
    run: AgentRun
    started_event: AgentRunEvent
    result: dict[str, Any]


@dataclass(frozen=True)
class AgentControlResult:
    event: AgentRunEvent
    resumed_result: dict[str, Any] | None = None
    resume_diagnostic: dict[str, Any] | None = None


def create_or_resume_agent_run(
    session: Session,
    *,
    public_id: str,
    session_id: str,
    goal: str,
    scope: dict[str, Any] | None = None,
    permission_profile: str = DEFAULT_PERMISSION_PROFILE,
    budget: dict[str, Any] | None = None,
) -> AgentRun:
    """创建或续接一次 AgentRun，public_id 对应 WebSocket 暴露的 run_id。"""

    normalized_id = public_id.strip() or uuid.uuid4().hex
    run = session.scalar(select(AgentRun).where(AgentRun.public_id == normalized_id))
    if run is None:
        run = AgentRun(
            public_id=normalized_id,
            session_id=session_id,
            book_run_id=_optional_positive_int((scope or {}).get("book_run_id")),
            goal=goal,
            scope=scope or {},
            permission_profile=permission_profile,
            budget=budget or {},
            status="running",
            root_plan=[],
            current_step=None,
        )
        session.add(run)
    else:
        run.session_id = session_id
        run.goal = goal
        run.scope = scope or run.scope or {}
        run.book_run_id = _optional_positive_int((scope or {}).get("book_run_id")) or run.book_run_id
        run.permission_profile = permission_profile or run.permission_profile
        run.budget = budget or run.budget or {}
        if run.status in AGENT_RUN_TERMINAL_STATUSES:
            run.status = "running"
    session.commit()
    session.refresh(run)
    return run


def start_agent_user_message_run(
    session: Session,
    *,
    agent_session_id: str,
    message: dict[str, Any],
) -> AgentRunStartResult:
    """为 WebSocket user_message 建立控制平面运行并写入 started 事件。"""

    user_message = _message_text(message)
    run_id = _optional_string(message.get("run_id")) or uuid.uuid4().hex
    args = message.get("args") if isinstance(message.get("args"), dict) else {}
    role_inputs = normalize_agent_role_inputs(args)
    run = create_or_resume_agent_run(
        session,
        public_id=run_id,
        session_id=agent_session_id,
        goal=user_message,
        scope=_scope_summary(args),
        permission_profile=_optional_string(message.get("permission_profile")) or DEFAULT_PERMISSION_PROFILE,
        budget=_budget_summary(args),
    )
    event = record_agent_event(
        session,
        run,
        event_type=AGENT_RUN_STARTED,
        actor="root-agent",
        message="Root Agent 已接收作者目标。",
        payload={
            "session_id": agent_session_id,
            "run_id": run.public_id,
            "user_message": user_message,
            "input_summary": _message_input_summary(message),
            "agent_role_hints": role_inputs.hints,
            "agent_role_mentions": role_inputs.mentions,
            "unknown_agent_role_hints": role_inputs.unknown_hints,
            "unknown_agent_role_mentions": role_inputs.unknown_mentions,
        },
    )
    return AgentRunStartResult(run=run, started_event=event)


def create_or_resume_bookrun_agent_run(
    session: Session,
    *,
    book_run: BookRun,
    event_source: str,
) -> AgentRun:
    """为 BookRun 旁路进度建立对应 AgentRun，让进度也进入统一事件源。"""

    writing_run = full_book_writing_run_event_data(book_run.id, book_run.status)
    run = create_or_resume_agent_run(
        session,
        public_id=f"bookrun-{book_run.id}",
        session_id=f"bookrun:{book_run.id}",
        goal=f"写作任务 #{book_run.id} managed 运行",
        scope={"book_id": book_run.book_id, "blueprint_id": book_run.blueprint_id, "book_run_id": book_run.id},
        permission_profile=DEFAULT_PERMISSION_PROFILE,
        budget=_book_run_budget(book_run),
    )
    if not _has_event(run, AGENT_RUN_STARTED):
        record_agent_event(
            session,
            run,
            event_type=AGENT_RUN_STARTED,
            actor="bookrun-agent",
            message="写作任务已进入 AgentRun 控制平面。",
            payload={**writing_run, "source": event_source},
        )
    if not _has_event(run, AGENT_PLAN_CREATED):
        record_agent_event(
            session,
            run,
            event_type=AGENT_PLAN_CREATED,
            actor="root-agent",
            message="Root Agent 已为写作任务选择 managed run skill。",
            payload=_agent_plan_payload(
                intent="bookrun.start",
                goal=run.goal,
                scope=run.scope,
                plan=_skill_by_name("bookrun_generation")["plan_template"],
            ),
        )
    return run


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
    """Agent Runtime Facade：WebSocket user_message 的唯一执行入口。"""

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


def record_agent_control_event(
    session: Session,
    *,
    public_id: str,
    session_id: str,
    control_type: str,
    payload: dict[str, Any] | None = None,
) -> AgentRunEvent:
    """记录 WebSocket 控制消息，避免权限与暂停指令停留在瞬时通道里。"""

    run = get_agent_run(session, public_id)
    writing_run_control_payload = _apply_book_run_control_if_needed(
        session,
        run=run,
        control_type=control_type,
        payload=payload or {},
    )
    event_type = _control_event_type(control_type)
    event_payload = {
        "session_id": session_id,
        "run_id": public_id,
        "control_type": control_type,
        **(payload or {}),
    }
    if writing_run_control_payload:
        event_payload.update(writing_run_control_payload)
    event = record_agent_event(
        session,
        run,
        event_type=event_type,
        actor="desktop-ide",
        message=_control_event_message(control_type),
        payload=event_payload,
    )
    if control_type == PAUSE_RUN:
        run.status = "paused"
        run.current_step = "paused"
    elif control_type == RESUME_RUN:
        run.status = "running"
        run.current_step = "resumed"
    elif control_type == STOP_RUN:
        run.status = "stopped"
        run.current_step = "stopped"
    elif control_type == APPROVE_PERMISSION_COMMAND and run.status == "paused":
        run.status = "completed"
        run.current_step = "completed"
    elif control_type == DENY_PERMISSION_COMMAND and run.status == "paused":
        run.status = "failed"
        run.current_step = "permission.denied"
    session.add(run)
    session.commit()
    if control_type == APPROVE_PERMISSION_COMMAND and run.status == "completed":
        record_agent_event(
            session,
            run,
            event_type=AGENT_RUN_COMPLETED,
            actor="root-agent",
            message="权限已批准，AgentRun 已完成待确认步骤。",
            payload={"session_id": session_id, "run_id": public_id, "control_type": control_type},
        )
    elif control_type == DENY_PERMISSION_COMMAND and run.status == "failed":
        record_agent_event(
            session,
            run,
            event_type=AGENT_RUN_FAILED,
            actor="permission-gate",
            message="作者拒绝权限请求，AgentRun 已停止。",
            payload={"session_id": session_id, "run_id": public_id, "control_type": control_type},
        )
    return event


def handle_agent_control_message(
    session: Session,
    *,
    public_id: str,
    session_id: str,
    control_type: str,
    payload: dict[str, Any] | None = None,
) -> AgentControlResult:
    event = record_agent_control_event(
        session,
        public_id=public_id,
        session_id=session_id,
        control_type=control_type,
        payload=payload,
    )
    resumed_result = None
    resume_diagnostic = None
    if control_type == RESUME_RUN:
        resumed_result, resume_diagnostic = _resume_agent_run_if_pending_with_diagnostic(
            session,
            public_id=public_id,
            agent_session_id=session_id,
        )
        if resume_diagnostic is not None:
            _record_resume_diagnostic(session, event, resume_diagnostic)
    return AgentControlResult(event=event, resumed_result=resumed_result, resume_diagnostic=resume_diagnostic)


def resume_agent_run_if_pending(
    session: Session,
    *,
    public_id: str,
    agent_session_id: str,
) -> dict[str, Any] | None:
    result, _diagnostic = _resume_agent_run_if_pending_with_diagnostic(
        session,
        public_id=public_id,
        agent_session_id=agent_session_id,
    )
    return result


def _resume_agent_run_if_pending_with_diagnostic(
    session: Session,
    *,
    public_id: str,
    agent_session_id: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    run = get_agent_run(session, public_id)
    pending = _latest_runtime_pending_call_artifact(session, run)
    if pending is None:
        return None, None
    payload = pending.payload if isinstance(pending.payload, dict) else {}
    diagnostic = build_runtime_pending_call_resume_diagnostic(
        run_status=run.status,
        current_step=run.current_step,
        payload=payload,
        artifact_id=pending.id,
        artifact_kind=pending.kind,
    )
    if diagnostic.get("can_resume") is not True:
        return None, diagnostic
    message = payload.get("resume_message") if isinstance(payload.get("resume_message"), dict) else None
    if message is None:
        return None, diagnostic
    result = execute_agent_user_message_run(
        session,
        run=run,
        agent_session_id=agent_session_id,
        message={
            **message,
            "run_id": run.public_id,
            "intent": payload.get("intent") if isinstance(payload.get("intent"), str) else message.get("intent"),
        },
    )
    result["run_id"] = run.public_id
    return result, None


def _record_resume_diagnostic(session: Session, event: AgentRunEvent, diagnostic: dict[str, Any]) -> None:
    payload = event.payload if isinstance(event.payload, dict) else {}
    recovery = payload.get("runtime_recovery") if isinstance(payload.get("runtime_recovery"), dict) else {}
    event.payload = {
        **payload,
        "runtime_recovery": {
            **recovery,
            "resume_diagnostic": diagnostic,
        },
    }
    session.add(event)
    session.commit()
    session.refresh(event)


def record_agent_command_event(
    session: Session,
    *,
    public_id: str | None,
    session_id: str,
    command_id: str,
    result_payload: dict[str, Any],
) -> AgentRunEvent | None:
    """把 WebSocket command 结果写回 AgentRunEvent；无 run_id 的旧调用保持兼容。"""

    if not public_id:
        return None
    run = get_agent_run(session, public_id)
    return record_agent_event(
        session,
        run,
        event_type=TOOL_TRACE,
        actor="tool-registry",
        message=f"命令 {command_id} 已执行。",
        payload={"session_id": session_id, "command_id": command_id, "result": result_payload},
    )


def _latest_runtime_pending_call_artifact(session: Session, run: AgentRun) -> AgentArtifact | None:
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
        if build_runtime_pending_call_summary(
            artifact.payload,
            artifact_id=artifact.id,
            artifact_kind=artifact.kind,
        ) is not None:
            return artifact
    return None


def record_book_run_snapshot(
    session: Session,
    *,
    book_run: BookRun,
    source: str,
) -> AgentRun:
    """把 BookRun 状态快照写入对应 long-running AgentRun。"""

    run = create_or_resume_bookrun_agent_run(session, book_run=book_run, event_source=source)
    payload = _book_run_snapshot_payload(book_run, source=source)
    record_agent_event(
        session,
        run,
        event_type=TOOL_TRACE,
        actor="bookrun-agent",
        message=f"写作任务 #{book_run.id} 状态更新为 {book_run.status}。",
        payload=payload,
    )
    if book_run.checkpoint:
        record_agent_artifact(
            session,
            run,
            kind="bookrun_checkpoint",
            payload={
                **payload,
                "checkpoint": book_run.checkpoint,
            },
            requires_confirmation=False,
        )
    if book_run.status == "completed":
        run.status = "completed"
        run.current_step = "completed"
        session.add(run)
        session.commit()
        record_agent_event(
            session,
            run,
            event_type=AGENT_RUN_COMPLETED,
            actor="bookrun-agent",
            message=f"写作任务 #{book_run.id} 已完成。",
            payload=payload,
        )
    elif book_run.status == "stopped":
        run.status = "stopped"
        run.current_step = "stopped"
        session.add(run)
        session.commit()
        record_agent_event(
            session,
            run,
            event_type=STOP_RUN,
            actor="bookrun-agent",
            message=f"写作任务 #{book_run.id} 已停止。",
            payload=payload,
        )
    elif book_run.status == "failed":
        fail_agent_run(session, run, message=f"写作任务 #{book_run.id} 状态为 {book_run.status}。", payload=payload)
    return run


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


def get_agent_run(session: Session, public_id: str) -> AgentRun:
    run = session.scalar(
        select(AgentRun)
        .options(selectinload(AgentRun.events), selectinload(AgentRun.artifacts))
        .where(AgentRun.public_id == public_id)
    )
    if run is None:
        raise AgentRunNotFoundError("AgentRun 不存在。")
    return run


_EVENT_SEQUENCE_RETRIES = 5


def record_agent_event(
    session: Session,
    run: AgentRun,
    *,
    event_type: str,
    actor: str,
    message: str = "",
    payload: dict[str, Any] | None = None,
) -> AgentRunEvent:
    """追加 AgentRunEvent，并按 run 内 sequence 保持可重放顺序。

    同一 run 可能被并发写入（流式运行线程 + 另一连接的控制消息），两个事务会读到
    相同的 max(sequence)；以 (run_id, sequence) 唯一索引为准，冲突方只回滚
    SAVEPOINT 内的插入并重读重试，调用方 session 里未提交的其他变更不受影响。"""

    for attempt in range(_EVENT_SEQUENCE_RETRIES):
        next_sequence = (
            session.scalar(select(func.max(AgentRunEvent.sequence)).where(AgentRunEvent.run_id == run.id)) or 0
        ) + 1
        event = AgentRunEvent(
            run_id=run.id,
            event_type=event_type,
            actor=actor,
            message=message,
            payload=payload or {},
            sequence=next_sequence,
        )
        try:
            with session.begin_nested():
                session.add(event)
                session.flush()
        except IntegrityError:
            if attempt == _EVENT_SEQUENCE_RETRIES - 1:
                raise
            continue
        session.commit()
        session.refresh(event)
        return event
    raise AgentOrchestrationError("AgentRunEvent sequence 分配重试耗尽。")


def record_agent_artifact(
    session: Session,
    run: AgentRun,
    *,
    kind: str,
    payload: dict[str, Any],
    requires_confirmation: bool = False,
) -> AgentArtifact:
    artifact = AgentArtifact(
        run_id=run.id,
        kind=kind,
        payload=payload,
        requires_confirmation=requires_confirmation,
    )
    session.add(artifact)
    session.commit()
    session.refresh(artifact)
    record_agent_event(
        session,
        run,
        event_type=AGENT_ARTIFACT,
        actor="root-agent",
        message=f"Root Agent 产出 {kind} artifact。",
        payload={
            "artifact_id": artifact.id,
            "kind": artifact.kind,
            "requires_confirmation": artifact.requires_confirmation,
            "payload": artifact.payload,
        },
    )
    return artifact


def record_subagent_run(
    session: Session,
    run: AgentRun,
    *,
    role: str,
    input_summary: dict[str, Any],
    output_summary: dict[str, Any],
    status: str,
) -> SubagentRun:
    subagent = SubagentRun(
        run_id=run.id,
        parent_run_id=None,
        role=role,
        input=input_summary,
        output=output_summary,
        status=status,
    )
    session.add(subagent)
    session.commit()
    session.refresh(subagent)
    return subagent


def complete_agent_run(
    session: Session,
    run: AgentRun,
    *,
    result: dict[str, Any],
) -> AgentRun:
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    run.status = "completed"
    run.assistant_session_id = _optional_positive_int(result.get("assistant_session_id"))
    run.current_step = "completed"
    session.add(run)
    session.commit()
    session.refresh(run)
    record_agent_event(
        session,
        run,
        event_type=AGENT_RUN_COMPLETED,
        actor="root-agent",
        message=str(agent_result.get("summary") or "AgentRun 已完成。"),
        payload={
            "intent": result.get("intent"),
            "assistant_session_id": result.get("assistant_session_id"),
            "requires_user_confirmation": bool(agent_result.get("requires_user_confirmation")),
        },
    )
    return run


def fail_agent_run(
    session: Session,
    run: AgentRun,
    *,
    message: str,
    payload: dict[str, Any] | None = None,
) -> AgentRun:
    run.status = "failed"
    run.current_step = "failed"
    session.add(run)
    session.commit()
    session.refresh(run)
    record_agent_event(
        session,
        run,
        event_type=AGENT_RUN_FAILED,
        actor="root-agent",
        message=message,
        payload=payload or {},
    )
    return run


def list_agent_run_events(session: Session, public_id: str) -> list[AgentRunEvent]:
    run = get_agent_run(session, public_id)
    return list(
        session.scalars(
            select(AgentRunEvent)
            .where(AgentRunEvent.run_id == run.id)
            .order_by(AgentRunEvent.sequence.asc(), AgentRunEvent.id.asc())
        )
    )


def list_agent_artifacts(session: Session, public_id: str) -> list[AgentArtifact]:
    run = get_agent_run(session, public_id)
    return list(
        session.scalars(
            select(AgentArtifact)
            .where(AgentArtifact.run_id == run.id, AgentArtifact.kind.not_in(HIDDEN_SYSTEM_ARTIFACT_KINDS))
            .order_by(AgentArtifact.id.asc())
        )
    )


def list_agent_checkpoints(session: Session, public_id: str) -> list[AgentArtifact]:
    run = get_agent_run(session, public_id)
    return list(
        session.scalars(
            select(AgentArtifact)
            .where(AgentArtifact.run_id == run.id, AgentArtifact.kind == "bookrun_checkpoint")
            .order_by(AgentArtifact.id.asc())
        )
    )


def get_agent_run_save_points(session: Session, public_id: str) -> dict[str, Any]:
    run = get_agent_run(session, public_id)
    events = list_agent_run_events(session, public_id)
    artifacts = _list_agent_save_point_artifacts(session, run)
    return build_agent_run_save_point_projection(run, events=events, artifacts=artifacts)


def _list_agent_save_point_artifacts(session: Session, run: AgentRun) -> list[AgentArtifact]:
    return list(
        session.scalars(
            select(AgentArtifact)
            .where(
                AgentArtifact.run_id == run.id,
                or_(
                    AgentArtifact.kind.not_in(HIDDEN_SYSTEM_ARTIFACT_KINDS),
                    AgentArtifact.kind == RUNTIME_PENDING_CALL_ARTIFACT_KIND,
                    AgentArtifact.kind == RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
                ),
            )
            .order_by(AgentArtifact.id.asc())
        )
    )


def _apply_book_run_control_if_needed(
    session: Session,
    *,
    run: AgentRun,
    control_type: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    if run.book_run_id is None:
        return None
    reason = _optional_string(payload.get("reason")) or _optional_string(payload.get("source"))
    try:
        if control_type == PAUSE_RUN:
            result = pause_writing_run(session, book_run_id=run.book_run_id, reason=reason)
            source = "agentrun.pause"
        elif control_type == RESUME_RUN:
            result = resume_writing_run(session, book_run_id=run.book_run_id)
            source = "agentrun.resume"
        elif control_type == STOP_RUN:
            result = stop_writing_run(session, book_run_id=run.book_run_id, reason=reason)
            source = "agentrun.stop"
        elif control_type == RETRY_FROM_CHECKPOINT:
            result = retry_writing_run_from_checkpoint(session, book_run_id=run.book_run_id)
            source = "agentrun.retry_from_checkpoint"
        else:
            return None
    except (BookRunBlockedError, BookRunNotFoundError) as exc:
        raise AgentRuntimeError(str(exc)) from exc
    book_run = result.book_run
    record_book_run_snapshot(session, book_run=book_run, source=source)
    return writing_run_payload(result)
