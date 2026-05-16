from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.events.schemas import EventLogRead, EventRecordCreate
from app.domains.events.service import EventWorkspaceNotFoundError, list_workspace_events, record_event

router = APIRouter(prefix="/api/events", tags=["事件流"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=EventLogRead, status_code=status.HTTP_201_CREATED)
def create_event_endpoint(payload: EventRecordCreate, session: SessionDependency) -> EventLogRead:
    try:
        return record_event(session, payload)
    except EventWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/workspaces/{workspace_id}", response_model=list[EventLogRead])
def list_workspace_events_endpoint(workspace_id: int, session: SessionDependency) -> list[EventLogRead]:
    try:
        return list(list_workspace_events(session, workspace_id))
    except EventWorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
