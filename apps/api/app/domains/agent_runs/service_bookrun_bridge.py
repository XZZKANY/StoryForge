from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs import run_payloads
from app.domains.agent_runs.event_types import (
    AGENT_RUN_COMPLETED,
    PAUSE_RUN,
    RESUME_RUN,
    RETRY_FROM_CHECKPOINT,
    STOP_RUN,
    TOOL_TRACE,
)
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.service_lifecycle import create_or_resume_bookrun_agent_run
from app.domains.agent_runs.service_store import fail_agent_run, record_agent_artifact, record_agent_event
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
    payload = run_payloads.book_run_snapshot_payload(book_run, source=source)
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
