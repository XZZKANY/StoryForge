from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException

from app.db.deps import SessionDependency
from app.domains.agent_runs.external_admission import agent_capabilities, require_managed_protocol
from app.domains.agent_runs.loop.external_chat import external_control_context
from app.domains.agent_runs.loop.external_resume import request_external_continuation, schedule_external_resume
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.loop.external_wait_store import read_external_wait
from app.domains.agent_runs.loop.external_writeback import (
    prepare_external_writeback,
    reconcile_external_writeback,
    reject_external_writeback,
)
from app.domains.agent_runs.service_store import assert_run_session_ownership, get_agent_run
from app.domains.agent_runs.writeback_contracts import (
    AgentCapabilitiesRead,
    WritebackPrepareRequest,
    WritebackRead,
    WritebackReconcileRequest,
)
from app.domains.agent_runs.writeback_projection import read_writeback

router = APIRouter()
HostGenerationHeader = Annotated[str | None, Header(alias="X-StoryForge-Host-Generation")]


@router.get("/capabilities", response_model=AgentCapabilitiesRead, summary="读取受管 Agent 执行协议能力")
def capabilities_endpoint() -> AgentCapabilitiesRead:
    return agent_capabilities()


@router.get("/{run_id}/writeback", response_model=WritebackRead, summary="按会话只读重建外部写回等待")
def read_writeback_endpoint(run_id: str, session_id: str, session: SessionDependency) -> WritebackRead:
    try:
        return read_writeback(session, run_id, session_id)
    except ExternalWritebackConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def require_wait_host(context, host_generation: str | None) -> str:
    generation = require_managed_protocol(host_generation)
    saved = read_external_wait(context.session, context.run)
    if saved.prepared.payload.get("external_execution", {}).get("host_generation") != generation:
        raise ExternalWritebackConflict("external_host_generation_changed")
    return generation


@router.post("/{run_id}/writeback/{wait_id}/prepare", response_model=WritebackRead, summary="绑定身份与 whole 写回决定")
def prepare_writeback_endpoint(run_id: str, wait_id: str, request: WritebackPrepareRequest,
                               session: SessionDependency, host_generation: HostGenerationHeader = None) -> WritebackRead:
    run = get_agent_run(session, run_id)
    assert_run_session_ownership(run, request.session_id)
    try:
        context = external_control_context(session, run)
        require_wait_host(context, host_generation)
        if request.decision == "reject":
            reject_external_writeback(context, wait_id=wait_id, expected_revision=request.expected_revision,
                                      permission_profile=request.permission_profile, execution_epoch=request.execution_epoch)
        else:
            prepare_external_writeback(context, wait_id=wait_id, expected_revision=request.expected_revision,
                                       identity=request.identity, decision=request.decision,
                                       permission_profile=request.permission_profile, execution_epoch=request.execution_epoch)
        return read_writeback(session, run_id, request.session_id)
    except ExternalWritebackConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{run_id}/writeback/{wait_id}/reconcile", response_model=WritebackRead, summary="核对原生回执并独立申请当前世代续跑")
def reconcile_writeback_endpoint(run_id: str, wait_id: str, request: WritebackReconcileRequest,
                                 session: SessionDependency, background: BackgroundTasks,
                                 host_generation: HostGenerationHeader = None) -> WritebackRead:
    run = get_agent_run(session, run_id)
    assert_run_session_ownership(run, request.session_id)
    try:
        if run.status in {"completed", "failed"}:
            projection = read_writeback(session, run_id, request.session_id)
            if (request.resume_intent == "observe_only" and projection.wait_id == wait_id
                    and projection.feedback_consumed and request.expected_revision <= projection.revision):
                return projection
            raise ExternalWritebackConflict("external_run_already_terminal")
        context = external_control_context(session, run)
        current = read_external_wait(session, run)
        # Reject has no Native operation. A repeated observe is still read-only.
        if current.wait.decision != "reject":
            current = reconcile_external_writeback(context, wait_id=wait_id, expected_revision=request.expected_revision)
        elif current.wait.wait_id != wait_id or current.wait.revision != request.expected_revision:
            raise ExternalWritebackConflict("external_wait_revision_conflict")
        if request.resume_intent == "continue_current_execution":
            generation = require_wait_host(context, host_generation)
            request_external_continuation(session, run, wait_id=wait_id, expected_revision=current.wait.revision,
                                          execution_epoch=request.execution_epoch, host_generation=generation)
            # No provider runs in this HTTP transaction/response body.
            background.add_task(schedule_external_resume, session.get_bind(), run_id)
        return read_writeback(session, run_id, request.session_id)
    except ExternalWritebackConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
