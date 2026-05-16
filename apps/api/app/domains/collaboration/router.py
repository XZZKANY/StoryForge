from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_session
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
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/comments", response_model=WorkspaceCommentRead, status_code=status.HTTP_201_CREATED)
def create_comment_endpoint(payload: WorkspaceCommentCreate, session: SessionDependency) -> WorkspaceCommentRead:
    try:
        return create_comment(session, payload)
    except CollaborationInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/approvals", response_model=ApprovalRequestRead, status_code=status.HTTP_201_CREATED)
def create_approval_request_endpoint(payload: ApprovalRequestCreate, session: SessionDependency) -> ApprovalRequestRead:
    try:
        return create_approval_request(session, payload)
    except CollaborationInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/approvals/{approval_request_id}/decisions", response_model=ApprovalDecisionRead, status_code=status.HTTP_201_CREATED)
def create_approval_decision_endpoint(
    approval_request_id: int,
    payload: ApprovalDecisionCreate,
    session: SessionDependency,
) -> ApprovalDecisionRead:
    try:
        return decide_approval(session, approval_request_id, payload)
    except CollaborationInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/scenes/{scene_id}/timeline", response_model=list[CollaborationTimelineItem])
def read_scene_timeline_endpoint(scene_id: int, session: SessionDependency) -> list[CollaborationTimelineItem]:
    return list(list_scene_timeline(session, scene_id))
