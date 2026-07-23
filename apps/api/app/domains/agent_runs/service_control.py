from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.redaction import redact_sensitive
from app.domains.agent_runs import run_payloads
from app.domains.agent_runs.event_types import (
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    APPROVE_PERMISSION_COMMAND,
    DENY_PERMISSION_COMMAND,
    PAUSE_RUN,
    RESUME_RUN,
    STOP_RUN,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    build_runtime_pending_call_resume_diagnostic,
    build_runtime_pending_call_summary,
)
from app.domains.agent_runs.service_bookrun_bridge import apply_book_run_control_if_needed
from app.domains.agent_runs.service_store import get_agent_run, record_agent_event
from app.domains.agent_runs.service_types import AGENT_RUN_TERMINAL_STATUSES, AgentControlResult

AgentRunExecutor = Callable[..., dict[str, Any]]


def record_agent_control_event(
    session: Session,
    *,
    public_id: str,
    session_id: str,
    control_type: str,
    payload: dict[str, Any] | None = None,
) -> AgentRunEvent:
    """记录 Agent 控制消息，避免权限与暂停指令停留在瞬时通道里。"""

    run = get_agent_run(session, public_id)
    writing_run_control_payload = apply_book_run_control_if_needed(
        session,
        run=run,
        control_type=control_type,
        payload=payload or {},
    )
    event_type = run_payloads.control_event_type(control_type)
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
        message=run_payloads.control_event_message(control_type),
        payload=event_payload,
    )
    # 守卫式 status 写：控制通道与运行时 worker 分处两条连接、彼此无协调，无条件写会「最后写入者胜」。
    # 终态 run 不得被迟到的 pause/stop 拖回非终态（否则 reap 不收 + 无线程驱动 + approve 门锁死
    # → 不可恢复僵尸，B1-001a）；resume 只从 paused 生效，终态 run 收到 resume 不复活（B1-001/D1-002）。
    if control_type == PAUSE_RUN and run.status not in AGENT_RUN_TERMINAL_STATUSES:
        run.status = "paused"
        run.current_step = "paused"
    elif control_type == RESUME_RUN and run.status == "paused":
        run.status = "running"
        run.current_step = "resumed"
    elif control_type == STOP_RUN and run.status not in AGENT_RUN_TERMINAL_STATUSES:
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
            payload={
                "session_id": session_id,
                "run_id": public_id,
                "control_type": control_type,
                "assistant_session_id": run.assistant_session_id,
            },
        )
    elif control_type == DENY_PERMISSION_COMMAND and run.status == "failed":
        record_agent_event(
            session,
            run,
            event_type=AGENT_RUN_FAILED,
            actor="permission-gate",
            message="作者拒绝权限请求，AgentRun 已停止。",
            payload={
                "session_id": session_id,
                "run_id": public_id,
                "control_type": control_type,
                "assistant_session_id": run.assistant_session_id,
            },
        )
    return event


def handle_agent_control_message(
    session: Session,
    *,
    public_id: str,
    session_id: str,
    control_type: str,
    execute_run: AgentRunExecutor,
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
            execute_run=execute_run,
        )
        if resume_diagnostic is not None:
            _record_resume_diagnostic(session, event, resume_diagnostic)
        elif resumed_result is None:
            resume_diagnostic = _park_unresumable_resumed_run(session, event, public_id=public_id)
    return AgentControlResult(event=event, resumed_result=resumed_result, resume_diagnostic=resume_diagnostic)


def resume_agent_run_if_pending(
    session: Session,
    *,
    public_id: str,
    agent_session_id: str,
    execute_run: AgentRunExecutor,
) -> dict[str, Any] | None:
    result, _diagnostic = _resume_agent_run_if_pending_with_diagnostic(
        session,
        public_id=public_id,
        agent_session_id=agent_session_id,
        execute_run=execute_run,
    )
    return result


def _resume_agent_run_if_pending_with_diagnostic(
    session: Session,
    *,
    public_id: str,
    agent_session_id: str,
    execute_run: AgentRunExecutor,
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
    result = execute_run(
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
    event.payload = redact_sensitive({
        **payload,
        "runtime_recovery": {
            **recovery,
            "resume_diagnostic": diagnostic,
        },
    })
    session.add(event)
    session.commit()
    session.refresh(event)


def _park_unresumable_resumed_run(
    session: Session,
    event: AgentRunEvent,
    *,
    public_id: str,
) -> dict[str, Any] | None:
    """RESUME 落到「无 runtime pending anchor、且非 BookRun 支撑」的纯 agent 循环（如 chat.explain）时的兜底。

    控制通道已无条件把 run 翻成 running/resumed（record_agent_control_event），但这类循环暂停即收尾、
    既没有活线程也没有可重放锚点，没人再驱动它 → 会永久钉在 running 僵尸态，只能等下次起服收尸。
    Path A：这类循环暂停即停止，恢复请重新发问；这里把 run 回落为 stopped 并记诊断，
    避免僵尸 run 与 UI 空转。BookRun 支撑的 run 由 apply_book_run_control_if_needed 真正驱动恢复，
    必须跳过不动。
    """

    run = get_agent_run(session, public_id)
    if run.book_run_id is not None or run.status != "running":
        return None
    run.status = "stopped"
    run.current_step = "stopped"
    session.add(run)
    session.commit()
    diagnostic = {
        "kind": "runtime_pending_call_resume",
        "can_resume": False,
        "resume_via_control_channel": False,
        "requires_manual_restart": False,
        "reason": "no_pending_call",
        "resume_strategy": "start_new_message",
        "reverted_status": "stopped",
    }
    _record_resume_diagnostic(session, event, diagnostic)
    return diagnostic


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
