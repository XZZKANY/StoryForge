from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.workspaces.schemas import WorkspaceCreate, WorkspaceMemberCreate, WorkspaceMemberRead, WorkspaceRead
from app.domains.workspaces.service import (
    WorkspaceNotFoundError,
    WorkspaceSeatLimitError,
    create_workspace,
    create_workspace_member,
    list_workspace_members,
    list_workspaces,
)

router = APIRouter(prefix="/api/workspaces", tags=["团队工作区"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
def create_workspace_endpoint(payload: WorkspaceCreate, session: SessionDependency) -> WorkspaceRead:
    return create_workspace(session, payload)


@router.get("", response_model=list[WorkspaceRead])
def list_workspaces_endpoint(session: SessionDependency) -> list[WorkspaceRead]:
    return list(list_workspaces(session))


@router.post("/{workspace_id}/members", response_model=WorkspaceMemberRead, status_code=status.HTTP_201_CREATED)
def create_workspace_member_endpoint(
    workspace_id: int,
    payload: WorkspaceMemberCreate,
    session: SessionDependency,
) -> WorkspaceMemberRead:
    try:
        return create_workspace_member(session, workspace_id, payload)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except WorkspaceSeatLimitError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberRead])
def list_workspace_members_endpoint(workspace_id: int, session: SessionDependency) -> list[WorkspaceMemberRead]:
    try:
        return list(list_workspace_members(session, workspace_id))
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
