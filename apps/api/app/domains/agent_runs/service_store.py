from __future__ import annotations

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.event_types import (
    AGENT_ARTIFACT,
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
)
from app.domains.agent_runs.events.contracts import CompletedEventPayload, FailedEventPayload
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
from app.domains.agent_runs.run_payloads import optional_positive_int
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
)
from app.domains.agent_runs.save_points import build_agent_run_save_point_projection
from app.domains.agent_runs.service_types import (
    AGENT_RUN_REAP_PRESERVED_STATUSES,
    AgentRunNotFoundError,
)
from app.domains.agent_runs.system_jobs import HIDDEN_SYSTEM_ARTIFACT_KINDS

_EVENT_SEQUENCE_RETRIES = 5


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
            message=redact_sensitive_text(message),
            payload=redact_sensitive(payload or {}),
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
        payload=redact_sensitive(payload),
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
        input=redact_sensitive(input_summary),
        output=redact_sensitive(output_summary),
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
    # 守卫式终态写：另一连接的控制通道可能在 worker 收尾窗口把 run 置为 stopped/paused。
    # 先 refresh 取最新 status，只有仍在 running 时才落 completed，否则尊重控制通道的中断
    # 决定、不盲写覆盖（B1-001b，同时覆盖 chat loop 与固定管线 B3-001；亦挡重复 complete）。
    session.refresh(run)
    if run.status != "running":
        return run
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    run.status = "completed"
    run.assistant_session_id = optional_positive_int(result.get("assistant_session_id"))
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
        payload=_completed_event_payload(result, agent_result),
    )
    return run


def _completed_event_payload(result: dict[str, Any], agent_result: dict[str, Any]) -> dict[str, Any]:
    """把重建终态所需的关键字段落进 AGENT_RUN_COMPLETED payload：断线/超时后前端拉事件表
    即可重建结果，不再因 agent_result 只走瞬时 _STREAM_RESULT 而丢失（F10）。
    不携带补丁 before/after 全文，避免事件表膨胀。"""

    return CompletedEventPayload.from_result(result, agent_result).to_payload()


completed_event_payload = _completed_event_payload


def fail_agent_run(
    session: Session,
    run: AgentRun,
    *,
    message: str,
    payload: dict[str, Any] | None = None,
) -> AgentRun:
    # 守卫式终态写：与 complete 对称。控制通道已把 run 置为 stopped/paused 时尊重其中断决定、
    # 不盲写 failed；亦挡重复 fail 事件。reap 与运行时错误路径调用时 run 恒为 running，守卫放行。
    session.refresh(run)
    if run.status != "running":
        return run
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
        payload=FailedEventPayload.from_payload(payload or {}).to_payload(),
    )
    return run


def reap_non_terminal_agent_runs(session: Session) -> int:
    """起服收尸：进程重启后仍停在 running 的 run 已无线程续跑，统一收为 failed 并写
    reason=process_restart 事件，避免永远挂 running 无人收尾（F09）。

    paused 不收：它是等待作者确认补丁 / 用户暂停的持久可恢复态，收尸会毁掉待确认补丁并
    锁死 approve 门（见 AGENT_RUN_REAP_PRESERVED_STATUSES）。"""

    stale_runs = list(
        session.scalars(
            select(AgentRun).where(AgentRun.status.not_in(AGENT_RUN_REAP_PRESERVED_STATUSES))
        )
    )
    for run in stale_runs:
        fail_agent_run(
            session,
            run,
            message="进程重启，运行未完成即收尸。",
            payload={"reason": "process_restart", "run_id": run.public_id},
        )
    return len(stale_runs)


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


list_agent_save_point_artifacts = _list_agent_save_point_artifacts
