from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.commercial.schemas import CommercialSummaryRead, WorkspaceSubscriptionCreate, WorkspaceSubscriptionRead
from app.domains.commercial.service import CommercialWorkspaceNotFoundError, build_commercial_summary, upsert_workspace_subscription

router = APIRouter(prefix="/api/commercial", tags=["商业化控制"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/workspaces/{workspace_id}/policy", response_model=WorkspaceSubscriptionRead, status_code=status.HTTP_201_CREATED)
def upsert_workspace_policy_endpoint(
    workspace_id: int,
    payload: WorkspaceSubscriptionCreate,
    session: SessionDependency,
) -> WorkspaceSubscriptionRead:
    try:
        return upsert_workspace_subscription(session, workspace_id, payload)
    except CommercialWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/workspaces/{workspace_id}/summary", response_model=CommercialSummaryRead)
def read_workspace_commercial_summary_endpoint(workspace_id: int, session: SessionDependency) -> CommercialSummaryRead:
    try:
        return build_commercial_summary(session, workspace_id)
    except CommercialWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
