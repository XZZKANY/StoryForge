from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.collaboration.schemas import (
    ApprovalDecisionCreate,
    ApprovalDecisionRead,
    ApprovalRequestCreate,
    ApprovalRequestRead,
    CollaborationTimelineItem,
    WorkspaceCommentCreate,
    WorkspaceCommentRead,
)
from app.domains.collaboration.service import (
    CollaborationInputError,
    create_approval_request,
    create_comment,
    decide_approval,
    list_scene_timeline,
)

router = APIRouter(prefix="/api/collaboration", tags=["协作审批"])


@router.post(
    "/comments",
    response_model=WorkspaceCommentRead,
    status_code=status.HTTP_201_CREATED,
    summary="提交工作区评论",
)
def create_comment_endpoint(payload: WorkspaceCommentCreate, session: SessionDependency) -> WorkspaceCommentRead:
    """对场景或制品添加协作评论；评论与场景绑定，按时间线展示。"""

    try:
        return create_comment(session, payload)
    except CollaborationInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/approvals",
    response_model=ApprovalRequestRead,
    status_code=status.HTTP_201_CREATED,
    summary="发起批准请求",
)
def create_approval_request_endpoint(payload: ApprovalRequestCreate, session: SessionDependency) -> ApprovalRequestRead:
    """针对场景或章节创建批准请求，等待审核者决议。"""

    try:
        return create_approval_request(session, payload)
    except CollaborationInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/approvals/{approval_request_id}/decisions",
    response_model=ApprovalDecisionRead,
    status_code=status.HTTP_201_CREATED,
    summary="提交批准决议",
)
def create_approval_decision_endpoint(
    approval_request_id: int,
    payload: ApprovalDecisionCreate,
    session: SessionDependency,
) -> ApprovalDecisionRead:
    """对批准请求做出 approve/reject 决议并附带备注。"""

    try:
        return decide_approval(session, approval_request_id, payload)
    except CollaborationInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/scenes/{scene_id}/timeline",
    response_model=list[CollaborationTimelineItem],
    summary="读取场景协作时间线",
)
def read_scene_timeline_endpoint(scene_id: int, session: SessionDependency) -> list[CollaborationTimelineItem]:
    """按时间顺序读取场景下的评论与批准事件，用于协作面板展示。"""

    return list(list_scene_timeline(session, scene_id))
