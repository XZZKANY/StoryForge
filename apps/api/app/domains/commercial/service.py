from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.books.models import Book
from app.domains.commercial.models import WorkspaceSubscription
from app.domains.commercial.schemas import WorkspaceSubscriptionCreate, CommercialSummaryRead
from app.domains.jobs.models import JobRun
from app.domains.workspaces.models import Workspace, WorkspaceMember


class CommercialWorkspaceNotFoundError(ValueError):
    """商业化控制引用了不存在的工作区。"""


def upsert_workspace_subscription(session: Session, workspace_id: int, payload: WorkspaceSubscriptionCreate) -> WorkspaceSubscription:
    workspace = session.get(Workspace, workspace_id)
    if workspace is None:
        raise CommercialWorkspaceNotFoundError("工作区不存在。")
    subscription = session.scalar(
        select(WorkspaceSubscription).where(WorkspaceSubscription.workspace_id == workspace_id).order_by(WorkspaceSubscription.id.desc())
    )
    if subscription is None:
        subscription = WorkspaceSubscription(workspace_id=workspace_id, **payload.model_dump())
        session.add(subscription)
    else:
        for key, value in payload.model_dump().items():
            setattr(subscription, key, value)
    workspace.seat_limit = payload.seat_limit
    session.commit()
    session.refresh(subscription)
    return subscription


def build_commercial_summary(session: Session, workspace_id: int) -> CommercialSummaryRead:
    workspace = session.get(Workspace, workspace_id)
    if workspace is None:
        raise CommercialWorkspaceNotFoundError("工作区不存在。")
    subscription = session.scalar(
        select(WorkspaceSubscription).where(WorkspaceSubscription.workspace_id == workspace_id).order_by(WorkspaceSubscription.id.desc())
    )
    active_member_count = int(session.scalar(select(func.count(WorkspaceMember.id)).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.status == "active")) or 0)
    job_rows = session.scalars(
        select(JobRun)
        .join(Book, JobRun.book_id == Book.id)
        .where(Book.workspace_id == workspace_id)
        .order_by(JobRun.id)
    ).all()
    current_job_count = len(job_rows)
    current_token_estimate = sum(int((job.progress or {}).get("token_usage", 0) or 0) for job in job_rows)
    seat_limit = subscription.seat_limit if subscription is not None else workspace.seat_limit
    monthly_job_limit = subscription.monthly_job_limit if subscription is not None else 0
    monthly_token_limit = subscription.monthly_token_limit if subscription is not None else 0
    within_seat_limit = active_member_count <= seat_limit
    within_job_limit = monthly_job_limit == 0 or current_job_count <= monthly_job_limit
    within_token_limit = monthly_token_limit == 0 or current_token_estimate <= monthly_token_limit
    within_limits = within_seat_limit and within_job_limit and within_token_limit
    return CommercialSummaryRead(
        workspace_id=workspace_id,
        seat_limit=seat_limit,
        active_member_count=active_member_count,
        monthly_job_limit=monthly_job_limit,
        current_job_count=current_job_count,
        monthly_token_limit=monthly_token_limit,
        current_token_estimate=current_token_estimate,
        within_limits=within_limits,
        status_summary=(
            f"席位 {active_member_count}/{seat_limit}，任务 {current_job_count}/{monthly_job_limit or '∞'}，"
            f"Token 估算 {current_token_estimate}/{monthly_token_limit or '∞'}。"
        ),
    )
