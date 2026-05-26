from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.commercial.schemas import CommercialSummaryRead, WorkspaceSubscriptionCreate, WorkspaceSubscriptionRead
from app.domains.commercial.service import (
    CommercialWorkspaceNotFoundError,
    build_commercial_summary,
    upsert_workspace_subscription,
)

router = APIRouter(prefix="/api/commercial", tags=["商业化控制"])


@router.post(
    "/workspaces/{workspace_id}/policy",
    response_model=WorkspaceSubscriptionRead,
    status_code=status.HTTP_201_CREATED,
    summary="更新工作区订阅策略",
)
def upsert_workspace_policy_endpoint(
    workspace_id: int,
    payload: WorkspaceSubscriptionCreate,
    session: SessionDependency,
) -> WorkspaceSubscriptionRead:
    """新建或覆盖工作区的订阅与配额策略。"""

    try:
        return upsert_workspace_subscription(session, workspace_id, payload)
    except CommercialWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/workspaces/{workspace_id}/summary",
    response_model=CommercialSummaryRead,
    summary="读取工作区商业化摘要",
)
def read_workspace_commercial_summary_endpoint(workspace_id: int, session: SessionDependency) -> CommercialSummaryRead:
    """读取工作区当前商业化用量、剩余配额和订阅状态摘要。"""

    try:
        return build_commercial_summary(session, workspace_id)
    except CommercialWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
