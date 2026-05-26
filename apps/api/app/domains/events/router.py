from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.events.schemas import EventLogRead, EventRecordCreate
from app.domains.events.service import EventWorkspaceNotFoundError, list_workspace_events, record_event

router = APIRouter(prefix="/api/events", tags=["事件流"])


@router.post(
    "",
    response_model=EventLogRead,
    status_code=status.HTTP_201_CREATED,
    summary="记录事件",
)
def create_event_endpoint(payload: EventRecordCreate, session: SessionDependency) -> EventLogRead:
    """追加一条工作区级事件流记录，可用于审计和回溯。"""

    try:
        return record_event(session, payload)
    except EventWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/workspaces/{workspace_id}",
    response_model=list[EventLogRead],
    summary="读取工作区事件流",
)
def list_workspace_events_endpoint(workspace_id: int, session: SessionDependency) -> list[EventLogRead]:
    """按时间倒序读取工作区下的事件流。"""

    try:
        return list(list_workspace_events(session, workspace_id))
    except EventWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
