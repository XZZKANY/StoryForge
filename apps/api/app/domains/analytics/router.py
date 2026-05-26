from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.analytics.schemas import WorkspaceAnalyticsRead
from app.domains.analytics.service import AnalyticsWorkspaceNotFoundError, build_workspace_analytics

router = APIRouter(prefix="/api/analytics", tags=["分析扩展"])


@router.get(
    "/workspaces/{workspace_id}/dashboard",
    response_model=WorkspaceAnalyticsRead,
    summary="读取工作区分析面板",
)
def read_workspace_analytics_endpoint(workspace_id: int, session: SessionDependency) -> WorkspaceAnalyticsRead:
    """聚合指定工作区维度的关键指标快照，用于运营看板和报表导出。"""

    try:
        return build_workspace_analytics(session, workspace_id)
    except AnalyticsWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
