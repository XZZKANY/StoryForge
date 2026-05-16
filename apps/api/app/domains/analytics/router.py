from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.analytics.schemas import WorkspaceAnalyticsRead
from app.domains.analytics.service import AnalyticsWorkspaceNotFoundError, build_workspace_analytics

router = APIRouter(prefix="/api/analytics", tags=["分析扩展"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/workspaces/{workspace_id}/dashboard", response_model=WorkspaceAnalyticsRead)
def read_workspace_analytics_endpoint(workspace_id: int, session: SessionDependency) -> WorkspaceAnalyticsRead:
    try:
        return build_workspace_analytics(session, workspace_id)
    except AnalyticsWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
