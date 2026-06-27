from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.common.exceptions import NotFoundError
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
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.schemas import AgentRoleRead, AgentSkillRead
from app.domains.agent_runs.system_jobs import HIDDEN_SYSTEM_ARTIFACT_KINDS
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.service import (
    BookRunBlockedError,
    BookRunNotFoundError,
)
from app.domains.ide.orchestrator import AgentOrchestrationError
from app.domains.writing_runs.service import (
    full_book_writing_run_event_data,
    pause_writing_run,
    resume_writing_run,
    retry_writing_run_from_checkpoint,
    stop_writing_run,
    writing_run_payload,
)

AGENT_RUN_TERMINAL_STATUSES = frozenset({"completed", "failed", "stopped"})

_AGENT_SKILL_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "name": "chapter_polish",
        "description": "单章润色闭环：加载上下文、多视角审稿、生成 proposed patch，并等待作者确认写回。",
        "trigger_intents": ["file.review", "file.revise", "chapter.review", "chapter.repair"],
        "plan_template": [
            {"step": "context.load", "detail": "读取当前章与项目上下文。", "status": "planned"},
            {"step": "subagents.review", "detail": "剧情、人物、文风和连续性子代理并行审稿。", "status": "planned"},
            {"step": "repair.propose", "detail": "将审稿结论综合为 proposed patch。", "status": "planned"},
            {"step": "permission.confirm", "detail": "文件写回前等待作者确认。", "status": "planned"},
        ],
        "tool_sequence": ["context.load", "file.review", "file.revise", "judge.run", "judge.repair"],
        "output_artifacts": ["review_report", "proposed_patch"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
    {
        "name": "short_story_draft",
        "description": "短篇创作流程：根据故事核、情绪钩子和目标读者生成可审稿初稿。",
        "trigger_intents": ["chat.explain"],
        "plan_template": [
            {"step": "brief.extract", "detail": "提取题材、主角、冲突和结尾反转。", "status": "planned"},
            {"step": "draft.write", "detail": "按短篇节奏生成完整初稿。", "status": "planned"},
            {"step": "judge.run", "detail": "检查情绪推进、反转和可读性。", "status": "planned"},
        ],
        "tool_sequence": ["context.load", "judge.run"],
        "output_artifacts": ["chapter_draft", "review_report"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
    {
        "name": "long_chapter_generate",
        "description": "长篇章节生成流程：按蓝图、Scene Packet 和连续性约束产出新章节草稿。",
        "trigger_intents": ["chat.explain", "chapter.review"],
        "plan_template": [
            {"step": "context.load", "detail": "读取蓝图、章节目标和连续性资料。", "status": "planned"},
            {"step": "chapter.generate", "detail": "生成章节草稿并保留证据链。", "status": "planned"},
            {"step": "judge.run", "detail": "审查事实、节奏和设定一致性。", "status": "planned"},
        ],
        "tool_sequence": ["context.load", "scene_packets.assemble", "judge.run"],
        "output_artifacts": ["chapter_draft", "review_report"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
    {
        "name": "consistency_review",
        "description": "一致性审查流程：聚焦设定、伏笔、人物关系、时间线和前后文事实冲突。",
        "trigger_intents": ["file.review", "chapter.review"],
        "plan_template": [
            {"step": "context.load", "detail": "读取当前稿和相关事实资料。", "status": "planned"},
            {"step": "continuity.review", "detail": "检查设定、伏笔、人物关系和时间线。", "status": "planned"},
            {"step": "synthesizer.merge", "detail": "合并冲突证据与修订建议。", "status": "planned"},
        ],
        "tool_sequence": ["context.load", "file.review", "judge.run"],
        "output_artifacts": ["review_report"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
    {
        "name": "bookrun_generation",
        "description": "managed Writing Run 长任务流程：按 checkpoint 推进长篇写作、暂停、恢复和失败重试。",
        "trigger_intents": ["bookrun.start"],
        "plan_template": [
            {"step": "bookrun.preflight", "detail": "确认蓝图、预算和章节范围。", "status": "planned"},
            {"step": "bookrun.start", "detail": "启动 managed Writing Run。", "status": "planned"},
            {"step": "bookrun.checkpoint", "detail": "每章生成后写入事件和 checkpoint。", "status": "planned"},
            {"step": "bookrun.resume", "detail": "支持暂停、恢复和从 checkpoint 重试。", "status": "planned"},
        ],
        "tool_sequence": ["bookrun.start", "bookrun.pause", "bookrun.resume", "bookrun.retry_from_checkpoint"],
        "output_artifacts": ["chapter_draft", "bookrun_checkpoint"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
)

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
        event_type="agent_run_started",
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
    if not _has_event(run, "agent_run_started"):
        record_agent_event(
            session,
            run,
            event_type="agent_run_started",
            actor="bookrun-agent",
            message="写作任务已进入 AgentRun 控制平面。",
            payload={**writing_run, "source": event_source},
        )
    if not _has_event(run, "agent_plan_created"):
        record_agent_event(
            session,
            run,
            event_type="agent_plan_created",
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
) -> dict[str, Any]:
    """由 Agent Runtime 作为唯一入口驱动 skill、tools、permission 和事件写入。"""

    try:
        runtime = AgentRuntime(_AgentRunEventSink(session))
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
) -> AgentRuntimeUserMessageResult:
    """Agent Runtime Facade：WebSocket user_message 的唯一执行入口。"""

    start = start_agent_user_message_run(session, agent_session_id=agent_session_id, message=message)
    run_id = start.run.public_id
    try:
        result = execute_agent_user_message_run(
            session,
            run=start.run,
            agent_session_id=agent_session_id,
            message={**message, "run_id": run_id},
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
    if control_type == "pause_run":
        run.status = "paused"
        run.current_step = "paused"
    elif control_type == "resume_run":
        run.status = "running"
        run.current_step = "resumed"
    elif control_type == "stop_run":
        run.status = "stopped"
        run.current_step = "stopped"
    elif control_type == "approve_permission" and run.status == "paused":
        run.status = "completed"
        run.current_step = "completed"
    elif control_type == "deny_permission" and run.status == "paused":
        run.status = "failed"
        run.current_step = "permission.denied"
    session.add(run)
    session.commit()
    if control_type == "approve_permission" and run.status == "completed":
        record_agent_event(
            session,
            run,
            event_type="agent_run_completed",
            actor="root-agent",
            message="权限已批准，AgentRun 已完成待确认步骤。",
            payload={"session_id": session_id, "run_id": public_id, "control_type": control_type},
        )
    elif control_type == "deny_permission" and run.status == "failed":
        record_agent_event(
            session,
            run,
            event_type="agent_run_failed",
            actor="permission-gate",
            message="作者拒绝权限请求，AgentRun 已停止。",
            payload={"session_id": session_id, "run_id": public_id, "control_type": control_type},
        )
    return event


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
        event_type="tool_trace",
        actor="tool-registry",
        message=f"命令 {command_id} 已执行。",
        payload={"session_id": session_id, "command_id": command_id, "result": result_payload},
    )


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
        event_type="tool_trace",
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
                **full_book_writing_run_event_data(book_run.id, book_run.status),
                "checkpoint": book_run.checkpoint,
                "source": source,
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
            event_type="agent_run_completed",
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
            event_type="stop_run",
            actor="bookrun-agent",
            message=f"写作任务 #{book_run.id} 已停止。",
            payload=payload,
        )
    elif book_run.status == "failed":
        fail_agent_run(session, run, message=f"写作任务 #{book_run.id} 状态为 {book_run.status}。", payload=payload)
    return run


def list_agent_skills() -> list[AgentSkillRead]:
    """返回 Root Agent 可选择的静态流程 skill 清单。"""

    return [AgentSkillRead.model_validate(skill) for skill in _AGENT_SKILL_DEFINITIONS]


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


def _skill_by_name(name: str) -> dict[str, Any]:
    for skill in _AGENT_SKILL_DEFINITIONS:
        if skill["name"] == name:
            return skill
    raise KeyError(f"Agent skill 不存在：{name}")


def _select_agent_skill(intent: object, goal: str, scope: dict[str, Any] | None) -> dict[str, Any]:
    normalized_intent = intent if isinstance(intent, str) else ""
    text = goal.lower()
    if normalized_intent == "bookrun.start":
        return _skill_by_name("bookrun_generation")
    if normalized_intent in {"file.revise", "chapter.repair"}:
        return _skill_by_name("chapter_polish")
    if normalized_intent in {"file.review", "chapter.review"}:
        if any(keyword in goal for keyword in ("一致性", "设定", "伏笔", "时间线", "前后文", "连续性")):
            return _skill_by_name("consistency_review")
        return _skill_by_name("chapter_polish")
    if any(keyword in goal for keyword in ("短篇", "盐言", "故事核", "反转")):
        return _skill_by_name("short_story_draft")
    if any(keyword in goal for keyword in ("生成章节", "写一章", "续写", "long chapter")) or _has_scope_key(
        scope,
        "scene_packet_id",
        "book_id",
        "blueprint_id",
    ):
        return _skill_by_name("long_chapter_generate")
    if "consistency" in text:
        return _skill_by_name("consistency_review")
    return _skill_by_name("chapter_polish")


def _agent_plan_payload(
    *,
    intent: object,
    goal: str,
    scope: dict[str, Any] | None,
    plan: list[dict[str, Any]],
) -> dict[str, Any]:
    selected_skill = _select_agent_skill(intent, goal, scope)
    return {
        "intent": intent,
        "plan": plan,
        "agent_role_hints": _scope_string_list(scope, "agent_role_hints"),
        "agent_role_mentions": _scope_string_list(scope, "agent_role_mentions"),
        "skill_version": "skills_v1",
        "selected_skill": {
            "name": selected_skill["name"],
            "description": selected_skill["description"],
            "permission_profile": selected_skill["permission_profile"],
            "tool_sequence": list(selected_skill["tool_sequence"]),
            "output_artifacts": list(selected_skill["output_artifacts"]),
        },
        "skill_plan_template": list(selected_skill["plan_template"]),
    }


def get_agent_run(session: Session, public_id: str) -> AgentRun:
    run = session.scalar(
        select(AgentRun)
        .options(selectinload(AgentRun.events), selectinload(AgentRun.artifacts))
        .where(AgentRun.public_id == public_id)
    )
    if run is None:
        raise AgentRunNotFoundError("AgentRun 不存在。")
    return run


def record_agent_event(
    session: Session,
    run: AgentRun,
    *,
    event_type: str,
    actor: str,
    message: str = "",
    payload: dict[str, Any] | None = None,
) -> AgentRunEvent:
    """追加 AgentRunEvent，并按 run 内 sequence 保持可重放顺序。"""

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
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


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
        event_type="agent_artifact",
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
        event_type="agent_run_completed",
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
        event_type="agent_run_failed",
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


def _record_orchestrator_result(session: Session, run: AgentRun, result: dict[str, Any]) -> None:
    plan = result.get("plan") if isinstance(result.get("plan"), list) else []
    run.root_plan = plan
    run.current_step = _current_plan_step(plan)
    run.assistant_session_id = _optional_positive_int(result.get("assistant_session_id"))
    run.book_run_id = _book_run_id_from_result(result) or run.book_run_id
    session.add(run)
    session.commit()
    session.refresh(run)
    record_agent_event(
        session,
        run,
        event_type="agent_plan_created",
        actor="root-agent",
        message="Root Agent 已创建执行计划。",
        payload=_agent_plan_payload(intent=result.get("intent"), goal=run.goal, scope=run.scope, plan=plan),
    )
    _record_tool_trace_events(session, run, result)
    _record_result_artifacts(session, run, result)
    _record_permission_if_needed(session, run, result)
    complete_agent_run(session, run, result=result)


class _AgentRunEventSink:
    """Adapter that lets AgentRuntime write to the existing AgentRun event store."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def record_plan(self, run: AgentRun, result: dict[str, Any]) -> None:
        plan = result.get("plan") if isinstance(result.get("plan"), list) else []
        run.root_plan = plan
        run.current_step = _current_plan_step(plan)
        run.assistant_session_id = _optional_positive_int(result.get("assistant_session_id"))
        run.book_run_id = _book_run_id_from_result(result) or run.book_run_id
        self._session.add(run)
        self._session.commit()
        self._session.refresh(run)
        record_agent_event(
            self._session,
            run,
            event_type="agent_plan_created",
            actor="root-agent",
            message="Root Agent 已创建执行计划。",
            payload=_agent_plan_payload(intent=result.get("intent"), goal=run.goal, scope=run.scope, plan=plan),
        )

    def record_tool_trace(self, run: AgentRun, trace: AgentToolTrace, index: int) -> None:
        input_summary = trace.input_summary
        output_summary = trace.output_summary or {}
        if trace.tool_name.startswith("subagent."):
            role = trace.tool_name.removeprefix("subagent.")
            record_agent_event(
                self._session,
                run,
                event_type="subagent_started",
                actor="root-agent",
                message=f"{role} 子代理开始执行。",
                payload={"index": index, "role": role, "input_summary": input_summary},
            )
            subagent = record_subagent_run(
                self._session,
                run,
                role=role,
                input_summary=input_summary,
                output_summary=output_summary,
                status=trace.status,
            )
            record_agent_event(
                self._session,
                run,
                event_type="subagent_completed",
                actor=role,
                message=f"{role} 子代理执行完成。",
                payload={"index": index, "subagent_run_id": subagent.id, "role": role, "output_summary": output_summary},
            )
        record_agent_event(
            self._session,
            run,
            event_type="tool_trace",
            actor="tool-registry",
            message=f"工具 {trace.tool_name} 返回 {trace.status}。",
            payload={"index": index, "trace": trace.as_dict()},
        )

    def record_artifact(
        self,
        run: AgentRun,
        *,
        kind: str,
        payload: dict[str, Any],
        requires_confirmation: bool,
    ) -> None:
        record_agent_artifact(
            self._session,
            run,
            kind=kind,
            payload=payload,
            requires_confirmation=requires_confirmation,
        )

    def record_permission_required(self, run: AgentRun, result: dict[str, Any], *, reason: str) -> None:
        agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
        proposed_patch = result.get("proposed_patch") if isinstance(result.get("proposed_patch"), dict) else None
        run.status = "paused"
        run.current_step = "permission.confirm"
        self._session.add(run)
        self._session.commit()
        self._session.refresh(run)
        record_agent_event(
            self._session,
            run,
            event_type="permission_required",
            actor="permission-gate",
            message="该步骤需要作者确认后才能继续。",
            payload={
                "permission_profile": run.permission_profile,
                "intent": result.get("intent"),
                "reason": reason,
                "proposed_patch": proposed_patch,
                "confirmation_action": agent_result.get("confirmation_action"),
                "blocked_tool": "file.revise" if proposed_patch else result.get("intent"),
            },
        )

    def record_system_job(
        self,
        run: AgentRun,
        *,
        key: str,
        payload: dict[str, Any],
        artifact_kind: str | None = None,
        artifact_payload: dict[str, Any] | None = None,
    ) -> None:
        if artifact_kind and artifact_payload is not None:
            record_agent_artifact(
                self._session,
                run,
                kind=artifact_kind,
                payload=artifact_payload,
                requires_confirmation=False,
            )
        actor = str(payload.get("actor") or f"system-{key}-agent")
        message = str(payload.get("message") or f"隐藏系统任务 {key} 已完成。")
        record_agent_event(
            self._session,
            run,
            event_type="system_job",
            actor=actor,
            message=message,
            payload={item_key: item_value for item_key, item_value in payload.items() if item_key != "message"},
        )

    def complete(self, run: AgentRun, result: dict[str, Any]) -> None:
        complete_agent_run(self._session, run, result=result)

    def fail(self, run: AgentRun, *, message: str, payload: dict[str, Any] | None = None) -> None:
        fail_agent_run(self._session, run, message=message, payload=payload)


def _record_tool_trace_events(session: Session, run: AgentRun, result: dict[str, Any]) -> None:
    tool_trace = result.get("tool_trace") if isinstance(result.get("tool_trace"), list) else []
    for index, trace in enumerate(tool_trace):
        if not isinstance(trace, dict):
            continue
        tool_name = str(trace.get("tool_name") or "unknown")
        input_summary = trace.get("input_summary") if isinstance(trace.get("input_summary"), dict) else {}
        output_summary = trace.get("output_summary") if isinstance(trace.get("output_summary"), dict) else {}
        status = str(trace.get("status") or "completed")
        if tool_name.startswith("subagent."):
            role = tool_name.removeprefix("subagent.")
            record_agent_event(
                session,
                run,
                event_type="subagent_started",
                actor="root-agent",
                message=f"{role} 子代理开始执行。",
                payload={"index": index, "role": role, "input_summary": input_summary},
            )
            subagent = record_subagent_run(
                session,
                run,
                role=role,
                input_summary=input_summary,
                output_summary=output_summary,
                status=status,
            )
            record_agent_event(
                session,
                run,
                event_type="subagent_completed",
                actor=role,
                message=f"{role} 子代理执行完成。",
                payload={"index": index, "subagent_run_id": subagent.id, "role": role, "output_summary": output_summary},
            )
        record_agent_event(
            session,
            run,
            event_type="tool_trace",
            actor="tool-registry",
            message=f"工具 {tool_name} 返回 {status}。",
            payload={"index": index, "trace": trace},
        )


def _record_result_artifacts(session: Session, run: AgentRun, result: dict[str, Any]) -> None:
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    review_report = agent_result.get("review_report")
    if isinstance(review_report, dict):
        record_agent_artifact(
            session,
            run,
            kind="review_report",
            payload=review_report,
            requires_confirmation=False,
        )
    proposed_patch = result.get("proposed_patch")
    if isinstance(proposed_patch, dict):
        record_agent_artifact(
            session,
            run,
            kind="proposed_patch",
            payload=proposed_patch,
            requires_confirmation=bool(proposed_patch.get("requires_confirmation", True)),
        )
    book_run = agent_result.get("book_run")
    if isinstance(book_run, dict) and isinstance(book_run.get("checkpoint"), list) and book_run["checkpoint"]:
        record_agent_artifact(
            session,
            run,
            kind="bookrun_checkpoint",
            payload={"book_run_id": book_run.get("id"), "checkpoint": book_run["checkpoint"]},
            requires_confirmation=False,
        )


def _record_permission_if_needed(session: Session, run: AgentRun, result: dict[str, Any]) -> None:
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    proposed_patch = result.get("proposed_patch") if isinstance(result.get("proposed_patch"), dict) else None
    requires_confirmation = bool(
        agent_result.get("requires_user_confirmation")
        or agent_result.get("confirmation_required")
        or (proposed_patch and proposed_patch.get("requires_confirmation"))
    )
    if not requires_confirmation:
        return
    record_agent_event(
        session,
        run,
        event_type="permission_required",
        actor="permission-gate",
        message="该步骤需要作者确认后才能继续。",
        payload={
            "permission_profile": run.permission_profile,
            "intent": result.get("intent"),
            "reason": "requires_user_confirmation",
            "proposed_patch": proposed_patch,
            "confirmation_action": agent_result.get("confirmation_action"),
        },
    )


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
        if control_type == "pause_run":
            result = pause_writing_run(session, book_run_id=run.book_run_id, reason=reason)
            source = "agentrun.pause"
        elif control_type == "resume_run":
            result = resume_writing_run(session, book_run_id=run.book_run_id)
            source = "agentrun.resume"
        elif control_type == "stop_run":
            result = stop_writing_run(session, book_run_id=run.book_run_id, reason=reason)
            source = "agentrun.stop"
        elif control_type == "retry_from_checkpoint":
            result = retry_writing_run_from_checkpoint(session, book_run_id=run.book_run_id)
            source = "agentrun.retry_from_checkpoint"
        else:
            return None
    except (BookRunBlockedError, BookRunNotFoundError) as exc:
        raise AgentRuntimeError(str(exc)) from exc
    book_run = result.book_run
    record_book_run_snapshot(session, book_run=book_run, source=source)
    return writing_run_payload(result)


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
