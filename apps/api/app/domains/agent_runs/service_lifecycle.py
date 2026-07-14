from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.agent_runs import run_payloads, skill_catalog
from app.domains.agent_runs.event_types import AGENT_PLAN_CREATED, AGENT_RUN_STARTED
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.role_catalog import DEFAULT_PERMISSION_PROFILE, normalize_agent_role_inputs
from app.domains.agent_runs.service_store import record_agent_event
from app.domains.agent_runs.service_types import AGENT_RUN_TERMINAL_STATUSES, AgentRunStartResult

if TYPE_CHECKING:
    from app.domains.book_runs.models import BookRun


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
    """创建或续接一次 AgentRun，public_id 对应实时帧暴露的 run_id。"""

    normalized_id = public_id.strip() or uuid.uuid4().hex
    run = session.scalar(select(AgentRun).where(AgentRun.public_id == normalized_id))
    if run is None:
        run = AgentRun(
            public_id=normalized_id,
            session_id=session_id,
            book_run_id=run_payloads.optional_positive_int((scope or {}).get("book_run_id")),
            goal=redact_sensitive_text(goal),
            scope=redact_sensitive(scope or {}),
            permission_profile=permission_profile,
            budget=redact_sensitive(budget or {}),
            status="running",
            root_plan=[],
            current_step=None,
        )
        session.add(run)
    else:
        run.session_id = session_id
        run.goal = redact_sensitive_text(goal)
        run.scope = redact_sensitive(scope or run.scope or {})
        run.book_run_id = run_payloads.optional_positive_int((scope or {}).get("book_run_id")) or run.book_run_id
        run.permission_profile = permission_profile or run.permission_profile
        run.budget = redact_sensitive(budget or run.budget or {})
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
    """为 Agent user_message 建立控制平面运行并写入 started 事件。"""

    user_message = run_payloads.message_text(message)
    run_id = run_payloads.optional_string(message.get("run_id")) or uuid.uuid4().hex
    args = message.get("args") if isinstance(message.get("args"), dict) else {}
    role_inputs = normalize_agent_role_inputs(args)
    run = create_or_resume_agent_run(
        session,
        public_id=run_id,
        session_id=agent_session_id,
        goal=user_message,
        scope=run_payloads.scope_summary(args),
        permission_profile=run_payloads.optional_string(message.get("permission_profile")) or DEFAULT_PERMISSION_PROFILE,
        budget=run_payloads.budget_summary(args),
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
            "input_summary": run_payloads.message_input_summary(message),
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

    from app.domains.writing_runs.service import full_book_writing_run_event_data

    writing_run = full_book_writing_run_event_data(book_run.id, book_run.status)
    run = create_or_resume_agent_run(
        session,
        public_id=f"bookrun-{book_run.id}",
        session_id=f"bookrun:{book_run.id}",
        goal=f"写作任务 #{book_run.id} managed 运行",
        scope={"book_id": book_run.book_id, "blueprint_id": book_run.blueprint_id, "book_run_id": book_run.id},
        permission_profile=DEFAULT_PERMISSION_PROFILE,
        budget=run_payloads.book_run_budget(book_run),
    )
    if not run_payloads.has_event(run, AGENT_RUN_STARTED):
        record_agent_event(
            session,
            run,
            event_type=AGENT_RUN_STARTED,
            actor="bookrun-agent",
            message="写作任务已进入 AgentRun 控制平面。",
            payload={**writing_run, "source": event_source},
        )
    if not run_payloads.has_event(run, AGENT_PLAN_CREATED):
        record_agent_event(
            session,
            run,
            event_type=AGENT_PLAN_CREATED,
            actor="root-agent",
            message="Root Agent 已为写作任务选择 managed run skill。",
            payload=skill_catalog.agent_plan_payload(
                intent="bookrun.start",
                goal=run.goal,
                scope=run.scope,
                plan=skill_catalog.skill_by_name("bookrun_generation")["plan_template"],
            ),
        )
    return run
