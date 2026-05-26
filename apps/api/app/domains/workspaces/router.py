from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
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


@router.post(
    "",
    response_model=WorkspaceRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建工作区",
)
def create_workspace_endpoint(payload: WorkspaceCreate, session: SessionDependency) -> WorkspaceRead:
    """创建工作区，承载团队成员、订阅策略、批准流程。"""

    return create_workspace(session, payload)


@router.get(
    "",
    response_model=list[WorkspaceRead],
    summary="读取工作区列表",
)
def list_workspaces_endpoint(session: SessionDependency) -> list[WorkspaceRead]:
    """列出当前用户可见的全部工作区。"""

    return list(list_workspaces(session))


@router.post(
    "/{workspace_id}/members",
    response_model=WorkspaceMemberRead,
    status_code=status.HTTP_201_CREATED,
    summary="添加工作区成员",
)
def create_workspace_member_endpoint(
    workspace_id: int,
    payload: WorkspaceMemberCreate,
    session: SessionDependency,
) -> WorkspaceMemberRead:
    """向工作区添加新成员，受订阅 seat 上限约束。"""

    try:
        return create_workspace_member(session, workspace_id, payload)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except WorkspaceSeatLimitError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/{workspace_id}/members",
    response_model=list[WorkspaceMemberRead],
    summary="读取工作区成员列表",
)
def list_workspace_members_endpoint(workspace_id: int, session: SessionDependency) -> list[WorkspaceMemberRead]:
    """读取工作区下的全部成员清单。"""

    try:
        return list(list_workspace_members(session, workspace_id))
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
