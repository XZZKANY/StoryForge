from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter, Scene
from app.domains.collaboration.models import ApprovalDecision, ApprovalRequest, WorkspaceComment
from app.domains.collaboration.schemas import (
    ApprovalDecisionCreate,
    ApprovalRequestCreate,
    CollaborationTimelineItem,
    WorkspaceCommentCreate,
)
from app.domains.events.schemas import EventRecordCreate
from app.domains.events.service import record_event
from app.domains.workspaces.service import require_active_member


class CollaborationInputError(ValueError):
    """协作对象缺失或归属不一致时抛出。"""


VALID_DECISIONS = {"approved", "changes_requested"}


def create_comment(session: Session, payload: WorkspaceCommentCreate) -> WorkspaceComment:
    require_active_member(session, payload.workspace_id, payload.member_id)
    _require_scene_in_workspace(session, payload.workspace_id, payload.scene_id)
    comment = WorkspaceComment(**payload.model_dump(), status="open")
    session.add(comment)
    session.commit()
    session.refresh(comment)
    record_event(
        session,
        EventRecordCreate(
            workspace_id=payload.workspace_id,
            scene_id=payload.scene_id,
            member_id=payload.member_id,
            event_type="comment_created",
            source="collaboration",
            payload={"comment_id": comment.id, "body": payload.body},
        ),
    )
    return comment


def create_approval_request(session: Session, payload: ApprovalRequestCreate) -> ApprovalRequest:
    require_active_member(session, payload.workspace_id, payload.requester_member_id)
    require_active_member(session, payload.workspace_id, payload.reviewer_member_id)
    _require_scene_in_workspace(session, payload.workspace_id, payload.scene_id)
    approval = ApprovalRequest(**payload.model_dump(), status="pending")
    session.add(approval)
    session.commit()
    session.refresh(approval)
    record_event(
        session,
        EventRecordCreate(
            workspace_id=payload.workspace_id,
            scene_id=payload.scene_id,
            member_id=payload.requester_member_id,
            event_type="approval_requested",
            source="collaboration",
            payload={"approval_request_id": approval.id, "reviewer_member_id": payload.reviewer_member_id},
        ),
    )
    return approval


def decide_approval(session: Session, approval_request_id: int, payload: ApprovalDecisionCreate) -> ApprovalDecision:
    approval = session.get(ApprovalRequest, approval_request_id)
    if approval is None:
        raise CollaborationInputError("审批请求不存在。")
    require_active_member(session, approval.workspace_id, payload.member_id)
    if payload.member_id != approval.reviewer_member_id:
        raise CollaborationInputError("只有指定审批人可以提交审批决策。")
    if payload.decision not in VALID_DECISIONS:
        raise CollaborationInputError("审批决策只支持 approved 或 changes_requested。")
    decision = ApprovalDecision(approval_request_id=approval_request_id, **payload.model_dump())
    approval.status = payload.decision
    session.add(decision)
    session.commit()
    session.refresh(decision)
    record_event(
        session,
        EventRecordCreate(
            workspace_id=approval.workspace_id,
            scene_id=approval.scene_id,
            member_id=payload.member_id,
            event_type="approval_decided",
            source="collaboration",
            payload={"approval_request_id": approval.id, "decision": payload.decision},
        ),
    )
    return decision


def list_scene_timeline(session: Session, scene_id: int) -> Sequence[CollaborationTimelineItem]:
    comments = session.scalars(select(WorkspaceComment).where(WorkspaceComment.scene_id == scene_id).order_by(WorkspaceComment.id)).all()
    approvals = session.scalars(select(ApprovalRequest).where(ApprovalRequest.scene_id == scene_id).order_by(ApprovalRequest.id)).all()
    timeline = [
        CollaborationTimelineItem(
            item_type="comment",
            item_id=comment.id,
            scene_id=comment.scene_id,
            status=comment.status,
            summary=comment.body,
            created_at=comment.created_at,
        )
        for comment in comments
    ]
    timeline.extend(
        CollaborationTimelineItem(
            item_type="approval",
            item_id=approval.id,
            scene_id=approval.scene_id,
            status=approval.status,
            summary=approval.summary,
            created_at=approval.created_at,
        )
        for approval in approvals
    )
    # SQLite 的 CURRENT_TIMESTAMP 精度只有秒级；评论和审批在同一秒写入时，
    # 需要保留构建顺序，避免把后创建的审批排到评论前面。
    return [
        item
        for _, item in sorted(
            enumerate(timeline),
            key=lambda pair: (pair[1].created_at, pair[0]),
        )
    ]


def _require_scene_in_workspace(session: Session, workspace_id: int, scene_id: int) -> Scene:
    scene = session.scalar(
        select(Scene)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .where(Scene.id == scene_id, Book.workspace_id == workspace_id)
    )
    if scene is None:
        raise CollaborationInputError("场景不存在或不属于该工作区。")
    return scene
