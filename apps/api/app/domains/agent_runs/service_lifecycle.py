from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.agent_runs import run_payloads, skill_catalog
from app.domains.agent_runs.event_types import AGENT_PLAN_CREATED, AGENT_RUN_STARTED
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.permission import (
    canonical_permission_profile,
    normalize_permission_profile,
)
from app.domains.agent_runs.role_catalog import normalize_agent_role_inputs
from app.domains.agent_runs.service_store import assert_run_session_ownership, record_agent_event
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
    permission_profile: str | None = None,
    budget: dict[str, Any] | None = None,
) -> AgentRun:
    """创建或续接一次 AgentRun，public_id 对应实时帧暴露的 run_id。"""

    normalized_id = public_id.strip() or uuid.uuid4().hex
    requested_profile = normalize_permission_profile(permission_profile)
    run = session.scalar(select(AgentRun).where(AgentRun.public_id == normalized_id))
    if run is None:
        run = AgentRun(
            public_id=normalized_id,
            session_id=session_id,
            book_run_id=run_payloads.optional_positive_int((scope or {}).get("book_run_id")),
            goal=redact_sensitive_text(goal),
            scope=redact_sensitive(scope or {}),
            permission_profile=requested_profile.profile,
            budget=redact_sensitive(budget or {}),
            status="running",
            root_plan=[],
            current_step=None,
        )
        session.add(run)
    else:
        # 归属守卫：不允许把属于另一会话的普通 chat run 静默 re-home 到入参会话（B1-002）。
        # managed 镜像 run（book_run_id 非空）session_id 恒为合成 bookrun:{id}、由 create_or_resume_bookrun
        # 复用，天然豁免；不符按「不存在」报错。
        assert_run_session_ownership(run, session_id)
        run.session_id = session_id
        run.goal = redact_sensitive_text(goal)
        run.scope = redact_sensitive(scope or run.scope or {})
        run.book_run_id = run_payloads.optional_positive_int((scope or {}).get("book_run_id")) or run.book_run_id
        stored_profile = normalize_permission_profile(run.permission_profile, allow_missing=False)
        run.permission_profile = (
            requested_profile.profile if permission_profile is not None else stored_profile.profile
        )
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
    raw_permission_profile = run_payloads.optional_string(message.get("permission_profile"))
    requested_profile = (
        normalize_permission_profile(raw_permission_profile, allow_missing=False)
        if raw_permission_profile is not None
        else None
    )
    run = create_or_resume_agent_run(
        session,
        public_id=run_id,
        session_id=agent_session_id,
        goal=user_message,
        scope=run_payloads.scope_summary(args),
        permission_profile=requested_profile.profile if requested_profile is not None else None,
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
            "permission_profile": run.permission_profile,
            **(
                {"profile_migrated_from": requested_profile.migrated_from}
                if requested_profile is not None and requested_profile.migrated_from is not None
                else {}
            ),
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
    mirror_public_id = f"bookrun-{book_run.id}"
    existing_mirror = session.scalar(select(AgentRun).where(AgentRun.public_id == mirror_public_id))
    inherited_profile: str | None = None
    if existing_mirror is None:
        source_profile = session.scalar(
            select(AgentRun.permission_profile)
            .where(AgentRun.book_run_id == book_run.id, AgentRun.public_id != mirror_public_id)
            .order_by(AgentRun.id.desc())
            .limit(1)
        )
        inherited_profile = canonical_permission_profile(source_profile)
    run = create_or_resume_agent_run(
        session,
        public_id=mirror_public_id,
        session_id=f"bookrun:{book_run.id}",
        goal=f"写作任务 #{book_run.id} managed 运行",
        scope={"book_id": book_run.book_id, "blueprint_id": book_run.blueprint_id, "book_run_id": book_run.id},
        permission_profile=inherited_profile,
        budget=run_payloads.book_run_budget(book_run),
    )
    if not run_payloads.has_event(run, AGENT_RUN_STARTED):
        record_agent_event(
            session,
            run,
            event_type=AGENT_RUN_STARTED,
            actor="bookrun-agent",
            message="写作任务已进入 AgentRun 控制平面。",
            payload={
                **writing_run,
                "source": event_source,
                "permission_profile": canonical_permission_profile(run.permission_profile),
            },
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
