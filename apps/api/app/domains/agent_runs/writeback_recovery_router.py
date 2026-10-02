from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import func, select

from app.db.deps import SessionDependency
from app.domains.agent_runs.fs.delivery_audit import inspect_delivery_audit
from app.domains.agent_runs.fs.native_receipts import inspect_native_writeback
from app.domains.agent_runs.loop.external_recovery import recover_external_wait
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.loop.external_wait_store import read_external_wait
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.agent_runs.service_store import assert_run_session_ownership, get_agent_run
from app.domains.agent_runs.writeback_contracts import (
    WritebackRecoveryItem,
    WritebackRecoveryList,
    WritebackRecoveryRead,
    WritebackRecoveryRequest,
)
from app.domains.agent_runs.writeback_projection import read_writeback

router = APIRouter()


@router.get("/writeback-recovery", response_model=WritebackRecoveryList, summary="按项目只读发现写回待办")
def list_recovery_endpoint(
    session: SessionDependency,
    project_path: Annotated[str, Query(min_length=1, max_length=4096)],
    session_id: str | None = None,
    after_id: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=20)] = 20,
):
    original_project = (
        select(AgentArtifact.payload["external_wait"]["project_path"].as_string())
        .where(
            AgentArtifact.run_id == AgentRun.id,
            AgentArtifact.kind == "runtime_checkpoint",
        )
        .order_by(AgentArtifact.id.desc())
        .limit(1)
        .correlate(AgentRun)
        .scalar_subquery()
    )
    query = select(AgentRun).where(
        AgentRun.id > after_id,
        func.coalesce(AgentRun.scope["project_path"].as_string(), original_project) == project_path,
        AgentRun.scope["execution_protocol"].as_string() == "external_writeback_v1",
        AgentRun.status.in_({"running", "paused", "stopped"}),
    )
    if session_id is not None:
        query = query.where(AgentRun.session_id == session_id)
    runs = list(session.scalars(query.order_by(AgentRun.id).limit(limit + 1)))
    items = []
    for run in runs[:limit]:
        try:
            projected = read_writeback(session, run.public_id, run.session_id)
            native_state, target_current, audit_ready = None, None, None
            reason = "external_recovery_stopped" if run.status == "stopped" else None
            if projected.identity is not None:
                wait = read_external_wait(session, run).wait
                try:
                    observation = inspect_native_writeback(wait.binding())
                    native_state = observation.state if observation else "missing"
                    target_current = observation.current if observation else None
                    if observation and observation.state == "applied":
                        audit_ready = inspect_delivery_audit(wait.binding())
                    if observation and (
                        observation.state == "outcome_unknown"
                        or observation.current in {"diverged", "unreadable", "missing"}
                    ):
                        reason = reason or "external_recovery_receipt_unsafe"
                except (ValueError, OSError):
                    reason = reason or "external_recovery_receipt_unsafe"
            items.append(
                WritebackRecoveryItem(
                    run_id=run.public_id,
                    session_id=run.session_id,
                    wait_id=projected.wait_id,
                    revision=projected.revision,
                    event_sequence=projected.event_sequence,
                    requested_path=projected.requested_path,
                    stage=projected.stage,
                    run_status=run.status,
                    historical_applied=projected.historical_applied,
                    blocked_reason=reason,
                    native_state=native_state,
                    target_current=target_current,
                    audit_ready=audit_ready,
                )
            )
        except ExternalWritebackConflict:
            items.append(
                WritebackRecoveryItem(
                    run_id=run.public_id,
                    session_id=run.session_id,
                    event_sequence=0,
                    run_status=run.status,
                    blocked_reason="external_recovery_checkpoint_invalid",
                )
            )
    return WritebackRecoveryList(items=items, next_after_id=runs[limit - 1].id if len(runs) > limit else None)


@router.post(
    "/{run_id}/writeback/{wait_id}/recover", response_model=WritebackRecoveryRead, summary="显式重新建立现场恢复资格"
)
def recover_endpoint(
    run_id: str,
    wait_id: str,
    request: WritebackRecoveryRequest,
    session: SessionDependency,
    host_generation: Annotated[str | None, Header(alias="X-StoryForge-Host-Generation")] = None,
):
    run = get_agent_run(session, run_id)
    assert_run_session_ownership(run, request.session_id)
    try:
        saved, mode = recover_external_wait(
            session,
            run,
            wait_id=wait_id,
            expected_revision=request.expected_revision,
            expected_event_sequence=request.expected_event_sequence,
            permission_profile=request.permission_profile,
            host_generation=host_generation,
        )
        return WritebackRecoveryRead(
            writeback=read_writeback(session, run_id, request.session_id),
            mode=mode,
            execution_epoch=None if mode == "audit_required" else saved.wait.execution_epoch,
        )
    except (ExternalWritebackConflict, OSError, ValueError) as exc:
        reason = str(exc) if isinstance(exc, ExternalWritebackConflict) else "external_recovery_unreadable"
        raise HTTPException(status_code=409, detail=reason) from exc
