from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.common.redaction import redact_sensitive
from app.domains.agent_runs import run_payloads
from app.domains.agent_runs.event_types import (
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    APPROVE_PERMISSION_COMMAND,
    DENY_PERMISSION_COMMAND,
    PAUSE_RUN,
    PERMISSION_REQUIRED,
    RESUME_RUN,
    STOP_RUN,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.agent_runs.permission import canonical_permission_profile
from app.domains.agent_runs.result_contracts import resolve_execution_result
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    build_runtime_pending_call_resume_diagnostic,
    build_runtime_pending_call_summary,
)
from app.domains.agent_runs.service_bookrun_bridge import apply_book_run_control_if_needed
from app.domains.agent_runs.service_execution import agent_execution_state, settle_agent_run_interruption
from app.domains.agent_runs.service_store import (
    assert_run_session_ownership,
    get_agent_run,
    record_agent_event,
    rollback_failed_settlement,
)
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

    if control_type in {RESUME_RUN, APPROVE_PERMISSION_COMMAND, "retry_from_checkpoint"}:
        from app.domains.agent_runs.host_lifecycle import HOST_LIFECYCLE

        HOST_LIFECYCLE.require_open()

    run = get_agent_run(session, public_id)
    assert_run_session_ownership(run, session_id)
    session.refresh(run)
    runtime_state = agent_execution_state(session, run)
    control_effect = "ignored"
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
    session.refresh(run)
    runtime_state = agent_execution_state(session, run)
    from app.domains.agent_runs.loop.external_wait_lifecycle import handle_external_control

    if handle_external_control(session, run, event, control_type=control_type, runtime_state=runtime_state):
        return event
    resolution = {}
    permission_transition = (
        control_type in {APPROVE_PERMISSION_COMMAND, DENY_PERMISSION_COMMAND}
        and run.status == "paused" and run.current_step == "permission.confirm"
        and runtime_state == "settled"
    )
    if permission_transition:
        pending = session.scalar(select(AgentRunEvent).where(
            AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == PERMISSION_REQUIRED,
        ).order_by(AgentRunEvent.sequence.desc()).limit(1))
        permission_transition = pending is not None
        if pending is not None:
            resolution = resolve_execution_result(pending.payload, approved=control_type == APPROVE_PERMISSION_COMMAND)
    # 守卫式 status 写：控制通道与运行时 worker 分处两条连接、彼此无协调，无条件写会「最后写入者胜」。
    # 终态 run 不得被迟到的 pause/stop 拖回非终态（否则 reap 不收 + 无线程驱动 + approve 门锁死
    # → 不可恢复僵尸，B1-001a）；resume 只从 paused 生效，终态 run 收到 resume 不复活（B1-001/D1-002）。
    with rollback_failed_settlement(session):
        if control_type == PAUSE_RUN and run.status not in AGENT_RUN_TERMINAL_STATUSES:
            changed = session.execute(update(AgentRun).where(
                AgentRun.id == run.id, AgentRun.status == run.status, AgentRun.current_step == run.current_step,
            ).values(status="paused", current_step="paused").execution_options(synchronize_session=False))
            session.refresh(run)
            control_effect = ("requested" if runtime_state == "in_flight" else "applied") if changed.rowcount == 1 else "ignored"
        elif (control_type == RESUME_RUN and run.status == "paused" and runtime_state == "settled"
              and run.current_step != "permission.confirm"):
            # Two control connections may both have read paused. Only the row
            # transition winner is authorized to start a resumed worker.
            claimed = session.execute(update(AgentRun).where(
                AgentRun.id == run.id, AgentRun.status == "paused",
                AgentRun.current_step == run.current_step,
            ).values(status="running", current_step="resumed").execution_options(synchronize_session=False))
            session.refresh(run)
            control_effect = "applied" if claimed.rowcount == 1 else "ignored"
        elif control_type == STOP_RUN and run.status not in AGENT_RUN_TERMINAL_STATUSES:
            changed = session.execute(update(AgentRun).where(
                AgentRun.id == run.id, AgentRun.status == run.status, AgentRun.current_step == run.current_step,
            ).values(status="stopped", current_step="stopped").execution_options(synchronize_session=False))
            session.refresh(run)
            control_effect = ("requested" if runtime_state == "in_flight" else "applied") if changed.rowcount == 1 else "ignored"
        elif control_type == STOP_RUN and run.status == "stopped" and runtime_state == "in_flight":
            control_effect = "requested"
        elif control_type == APPROVE_PERMISSION_COMMAND and permission_transition:
            run.status = "failed" if resolution else "completed"
            run.current_step = "permission.approved" if resolution else "completed"
            control_effect = "applied"
        elif control_type == DENY_PERMISSION_COMMAND and permission_transition:
            run.status = "failed"
            run.current_step = "permission.denied"
            control_effect = "applied"
        event.payload = {**event.payload, "control_effect": control_effect, "runtime_state": runtime_state, "run_status": run.status}
        session.add_all([run, event])
        if control_type in {PAUSE_RUN, STOP_RUN} and control_effect == "applied" and run.book_run_id is None:
            settle_agent_run_interruption(session, run)
        elif control_type == APPROVE_PERMISSION_COMMAND and permission_transition:
            record_agent_event(
                session,
                run,
                event_type=AGENT_RUN_FAILED if resolution else AGENT_RUN_COMPLETED,
                actor="root-agent",
                message="作者已批准已有提案；本轮执行仍未完成。" if resolution else "权限已批准，AgentRun 已完成待确认步骤。",
                payload={
                    "session_id": session_id,
                    "run_id": public_id,
                    "control_type": control_type,
                    **resolution,
                    "assistant_session_id": run.assistant_session_id,
                    "permission_profile": canonical_permission_profile(run.permission_profile),
                },
            )
        elif control_type == DENY_PERMISSION_COMMAND and permission_transition and run.status == "failed":
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
                    **resolution,
                    "assistant_session_id": run.assistant_session_id,
                    "permission_profile": canonical_permission_profile(run.permission_profile),
                },
            )
        else:
            session.commit()
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
    if control_type == RESUME_RUN and event.payload.get("control_effect") == "applied":
        resumed_result, resume_diagnostic = _resume_agent_run_if_pending_with_diagnostic(
            session,
            public_id=public_id,
            agent_session_id=session_id,
            execute_run=execute_run,
            control_payload=payload or {},
        )
        if resume_diagnostic is not None:
            _record_resume_diagnostic(session, event, resume_diagnostic)
        elif resumed_result is None:
            resume_diagnostic = _park_unresumable_resumed_run(session, event, public_id=public_id)
    if control_type == RESUME_RUN and event.payload.get("control_effect") == "ignored":
        run = get_agent_run(session, public_id)
        if run.status == "running" and run.current_step == "resumed" and _latest_runtime_pending_call_artifact(session, run) is None:
            resume_diagnostic = _park_unresumable_resumed_run(session, event, public_id=public_id)
    if control_type == RESUME_RUN:
        run = get_agent_run(session, public_id)
        session.refresh(run)
        event.payload = {**event.payload, "runtime_state": agent_execution_state(session, run), "run_status": run.status}
        session.add(event)
        session.commit()
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
        control_payload={},
    )
    return result


def _resume_agent_run_if_pending_with_diagnostic(
    session: Session,
    *,
    public_id: str,
    agent_session_id: str,
    execute_run: AgentRunExecutor,
    control_payload: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    run = get_agent_run(session, public_id)
    assert_run_session_ownership(run, agent_session_id)
    pending = _latest_runtime_pending_call_artifact(session, run)
    if pending is None:
        from app.domains.agent_runs.loop.recovery import resume_checkpoint_run

        return resume_checkpoint_run(session, run, agent_session_id=agent_session_id, execute_run=execute_run)
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
    resume_message = dict(message)
    if payload.get("intent") == "chapter.write":
        candidate = (control_payload or {}).get("chapter_brief")
        if isinstance(candidate, dict):
            resume_args = dict(resume_message.get("args") or {})
            resume_args["chapter_brief"] = redact_sensitive(candidate)
            resume_message["args"] = resume_args
    result = execute_run(
        session,
        run=run,
        agent_session_id=agent_session_id,
        message={
            **resume_message,
            "run_id": run.public_id,
            "intent": payload.get("intent") if isinstance(payload.get("intent"), str) else message.get("intent"),
        },
    )
    result["run_id"] = run.public_id
    return result, None


def _record_resume_diagnostic(
    session: Session, event: AgentRunEvent, diagnostic: dict[str, Any], *, commit: bool = True,
) -> None:
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
    if commit:
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
    from app.domains.agent_runs.loop.checkpoint_store import latest_checkpoint_artifact

    if latest_checkpoint_artifact(session, run) is not None:
        return None
    with rollback_failed_settlement(session):
        run.status = "stopped"
        run.current_step = "stopped"
        session.add(run)
        diagnostic = {
            "kind": "runtime_pending_call_resume",
            "can_resume": False,
            "resume_via_control_channel": False,
            "requires_manual_restart": False,
            "reason": "no_pending_call",
            "resume_strategy": "start_new_message",
            "reverted_status": "stopped",
        }
        _record_resume_diagnostic(session, event, diagnostic, commit=False)
        settle_agent_run_interruption(session, run)
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
