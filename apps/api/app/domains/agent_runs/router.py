from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.db.deps import SessionDependency
from app.domains.agent_runs.events import (
    materialize_knowledge_proposal,
    query_knowledge_proposal_inbox,
    refresh_knowledge_evidence,
    resolve_knowledge_proposal,
    revise_knowledge_proposal_group,
)
from app.domains.agent_runs.schemas import (
    AgentArtifactRead,
    AgentRoleRead,
    AgentRunEventRead,
    AgentRunRead,
    AgentSkillRead,
    KnowledgeProposalInboxRead,
    KnowledgeProposalMaterializeRequest,
    KnowledgeProposalPatchRead,
    KnowledgeProposalQuery,
    KnowledgeProposalResolveRequest,
    KnowledgeProposalReviseRequest,
)
from app.domains.agent_runs.service import (
    encode_agent_run_sse_event,
    get_agent_run,
    get_agent_run_save_points,
    list_agent_artifacts,
    list_agent_checkpoints,
    list_agent_roles,
    list_agent_run_events,
    list_agent_skills,
    resolve_agent_role_alias,
)

router = APIRouter(prefix="/api/agent-runs", tags=["Agent Runtime"])


@router.post(
    "/knowledge-proposals/query",
    response_model=KnowledgeProposalInboxRead,
    response_model_exclude_none=True,
    summary="按项目读取 Knowledge Inbox",
)
def query_knowledge_proposals_endpoint(
    request: KnowledgeProposalQuery,
    session: SessionDependency,
) -> KnowledgeProposalInboxRead:
    return KnowledgeProposalInboxRead.model_validate(
        query_knowledge_proposal_inbox(session, request.project_root)
    )


@router.post(
    "/knowledge-proposals/refresh",
    response_model=KnowledgeProposalInboxRead,
    response_model_exclude_none=True,
    summary="刷新 Knowledge Inbox 来源证据",
)
def refresh_knowledge_proposals_endpoint(
    request: KnowledgeProposalQuery,
    session: SessionDependency,
) -> KnowledgeProposalInboxRead:
    return KnowledgeProposalInboxRead.model_validate(
        refresh_knowledge_evidence(session, request.project_root)
    )


@router.post(
    "/knowledge-proposals/materialize",
    response_model=KnowledgeProposalPatchRead,
    summary="生成强制确认的 Project Knowledge patch",
)
def materialize_knowledge_proposal_endpoint(
    request: KnowledgeProposalMaterializeRequest,
    session: SessionDependency,
) -> KnowledgeProposalPatchRead:
    try:
        return KnowledgeProposalPatchRead.model_validate(
            materialize_knowledge_proposal(
                session,
                project_root=request.project_root,
                artifact_id=request.artifact_id,
                revision=request.revision,
                proposal_id=request.proposal_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/knowledge-proposals/revise",
    response_model=KnowledgeProposalInboxRead,
    response_model_exclude_none=True,
    summary="编辑并重建 Knowledge proposal revision",
)
def revise_knowledge_proposal_endpoint(
    request: KnowledgeProposalReviseRequest,
    session: SessionDependency,
) -> KnowledgeProposalInboxRead:
    try:
        return KnowledgeProposalInboxRead.model_validate(
            revise_knowledge_proposal_group(
                session,
                project_root=request.project_root,
                artifact_id=request.artifact_id,
                revision=request.revision,
                proposals=[item.model_dump(exclude_none=True) for item in request.proposals],
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/knowledge-proposals/resolve",
    response_model=KnowledgeProposalInboxRead,
    response_model_exclude_none=True,
    summary="拒绝 Knowledge proposal",
)
def resolve_knowledge_proposal_endpoint(
    request: KnowledgeProposalResolveRequest,
    session: SessionDependency,
) -> KnowledgeProposalInboxRead:
    try:
        return KnowledgeProposalInboxRead.model_validate(
            resolve_knowledge_proposal(
                session,
                project_root=request.project_root,
                artifact_id=request.artifact_id,
                revision=request.revision,
                proposal_id=request.proposal_id,
                resolution=request.resolution,
                patch_identity=request.patch_identity,
                author_confirmation_event_id=request.author_confirmation_event_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/skills", response_model=list[AgentSkillRead], summary="读取 Agent skills v1 清单")
def list_agent_skills_endpoint() -> list[AgentSkillRead]:
    """列出 Root Agent 可选择的流程 skills；端点只读，不执行工具。"""

    return list_agent_skills()


@router.get("/roles", response_model=list[AgentRoleRead], summary="读取 Agent role catalog v1")
def list_agent_roles_endpoint() -> list[AgentRoleRead]:
    """列出 Primary Agent 与 Subagents 的只读角色目录。"""

    return list_agent_roles()


@router.get("/roles/resolve", response_model=AgentRoleRead | None, summary="解析 Agent role alias")
def resolve_agent_role_alias_endpoint(alias: str) -> AgentRoleRead | None:
    """按 @剧情 这类用户可输入别名解析 role；未知 alias 返回 null。"""

    return resolve_agent_role_alias(alias)


@router.get("/{run_id}", response_model=AgentRunRead, summary="读取 AgentRun")
def get_agent_run_endpoint(run_id: str, session: SessionDependency) -> AgentRunRead:
    """按 WebSocket 暴露的 run_id 读取一次 AgentRun。"""

    return get_agent_run(session, run_id)


@router.get("/{run_id}/save-points", summary="读取 AgentRun save point 投影")
def get_agent_run_save_points_endpoint(run_id: str, session: SessionDependency) -> dict[str, object]:
    """从 AgentRunEvent / AgentArtifact 事实源推导当前可恢复边界。"""

    return get_agent_run_save_points(session, run_id)


@router.get("/{run_id}/events", response_model=list[AgentRunEventRead], summary="读取 AgentRun 事件")
def list_agent_run_events_endpoint(run_id: str, session: SessionDependency) -> list[AgentRunEventRead]:
    """按写入顺序读取 AgentRunEvent，用于断线后恢复。"""

    return list_agent_run_events(session, run_id)


@router.get("/{run_id}/artifacts", response_model=list[AgentArtifactRead], summary="读取 AgentRun artifacts")
def list_agent_artifacts_endpoint(run_id: str, session: SessionDependency) -> list[AgentArtifactRead]:
    """读取 AgentRun 产物，包括审稿报告、待确认补丁和 checkpoint。"""

    return list_agent_artifacts(session, run_id)


@router.get("/{run_id}/checkpoints", response_model=list[AgentArtifactRead], summary="读取 AgentRun checkpoints")
def list_agent_checkpoints_endpoint(run_id: str, session: SessionDependency) -> list[AgentArtifactRead]:
    """读取 AgentRun 派生的 BookRun checkpoint artifacts。"""

    return list_agent_checkpoints(session, run_id)


@router.get("/{run_id}/events/stream", summary="读取 AgentRun SSE 事件流")
def stream_agent_run_events_endpoint(run_id: str, session: SessionDependency) -> StreamingResponse:
    """从 AgentRunEvent Store 生成 SSE 快照，端点本身不做任何决策。"""

    events = list_agent_run_events(session, run_id)

    def event_stream():
        for event in events:
            yield encode_agent_run_sse_event(event)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
