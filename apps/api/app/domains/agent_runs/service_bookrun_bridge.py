from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs import run_payloads
from app.domains.agent_runs.event_types import (
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    PAUSE_RUN,
    RESUME_RUN,
    RETRY_FROM_CHECKPOINT,
    STOP_RUN,
    TOOL_TRACE,
)
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.permission import canonical_permission_profile
from app.domains.agent_runs.service_lifecycle import create_or_resume_bookrun_agent_run
from app.domains.agent_runs.service_store import (
    record_agent_artifact,
    record_agent_event,
    rollback_failed_settlement,
)
from app.domains.agent_runs.service_types import AgentRuntimeError
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.service import BookRunBlockedError, BookRunNotFoundError
from app.domains.writing_runs.service import (
    pause_writing_run,
    resume_writing_run,
    retry_writing_run_from_checkpoint,
    stop_writing_run,
    writing_run_payload,
)


def record_book_run_snapshot(
    session: Session,
    *,
    book_run: BookRun,
    source: str,
) -> AgentRun:
    """把 BookRun 状态快照写入对应 long-running AgentRun。"""

    run = create_or_resume_bookrun_agent_run(session, book_run=book_run, event_source=source)
    payload = {
        **run_payloads.book_run_snapshot_payload(book_run, source=source),
        "permission_profile": canonical_permission_profile(run.permission_profile),
    }
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
    if book_run.status in {"completed", "stopped", "failed"}:
        # 镜像投影服从已提交的上游事实，不复用仅允许 running 的 worker 终态守卫。
        # 保留重复 snapshot 的事件语义，但不能先把既有终态提交回 running。
        with rollback_failed_settlement(session):
            run.status = book_run.status
            run.current_step = book_run.status
            session.add(run)
            if book_run.status == "completed":
                event_type, actor = AGENT_RUN_COMPLETED, "bookrun-agent"
                message = f"写作任务 #{book_run.id} 已完成。"
            elif book_run.status == "stopped":
                event_type, actor = STOP_RUN, "bookrun-agent"
                message = f"写作任务 #{book_run.id} 已停止。"
            else:
                event_type, actor = AGENT_RUN_FAILED, "root-agent"
                message = f"写作任务 #{book_run.id} 状态为 {book_run.status}。"
            record_agent_event(
                session,
                run,
                event_type=event_type,
                actor=actor,
                message=message,
                payload=payload,
            )
    return run


def apply_book_run_control_if_needed(
    session: Session,
    *,
    run: AgentRun,
    control_type: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    if run.book_run_id is None:
        return None
    reason = run_payloads.optional_string(payload.get("reason")) or run_payloads.optional_string(payload.get("source"))
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
