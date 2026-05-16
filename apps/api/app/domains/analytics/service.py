from __future__ import annotations

from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.analytics.schemas import AnalyticsFailureCategoryRead, WorkspaceAnalyticsRead
from app.domains.books.models import Book, Chapter, Scene
from app.domains.collaboration.models import ApprovalDecision, ApprovalRequest, WorkspaceComment
from app.domains.events.models import EventLog
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.provider_gateway.models import ProviderConfig
from app.domains.workspaces.models import Workspace, WorkspaceMember


class AnalyticsWorkspaceNotFoundError(ValueError):
    """分析层查询的工作区不存在。"""


def build_workspace_analytics(session: Session, workspace_id: int) -> WorkspaceAnalyticsRead:
    if session.get(Workspace, workspace_id) is None:
        raise AnalyticsWorkspaceNotFoundError("工作区不存在。")
    active_member_count = int(session.scalar(select(func.count(WorkspaceMember.id)).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.status == "active")) or 0)
    scene_ids = list(
        session.scalars(
            select(Scene.id)
            .join(Chapter, Scene.chapter_id == Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(Book.workspace_id == workspace_id)
            .order_by(Scene.id)
        ).all()
    )
    comment_count = int(session.scalar(select(func.count(WorkspaceComment.id)).where(WorkspaceComment.workspace_id == workspace_id)) or 0)
    pending_approval_count = int(session.scalar(select(func.count(ApprovalRequest.id)).where(ApprovalRequest.workspace_id == workspace_id, ApprovalRequest.status == "pending")) or 0)
    decision_rows = session.scalars(
        select(ApprovalDecision)
        .join(ApprovalRequest, ApprovalDecision.approval_request_id == ApprovalRequest.id)
        .where(ApprovalRequest.workspace_id == workspace_id)
        .order_by(ApprovalDecision.id)
    ).all()
    approved_count = sum(1 for row in decision_rows if row.decision == "approved")
    approval_pass_rate = _safe_ratio(approved_count, len(decision_rows))
    repair_rows = session.scalars(select(RepairPatch).where(RepairPatch.scene_id.in_(scene_ids)).order_by(RepairPatch.id)).all() if scene_ids else []
    accepted_repairs = sum(1 for row in repair_rows if row.status == "accepted")
    repair_acceptance_rate = _safe_ratio(accepted_repairs, len(repair_rows))
    job_rows = session.scalars(select(JobRun).join(Book, JobRun.book_id == Book.id).where(Book.workspace_id == workspace_id).order_by(JobRun.id)).all()
    completed_jobs = sum(1 for row in job_rows if row.status == "completed")
    job_success_rate = _safe_ratio(completed_jobs, len(job_rows))
    recent_event_count = int(session.scalar(select(func.count(EventLog.id)).where(EventLog.workspace_id == workspace_id)) or 0)
    active_provider_count = int(session.scalar(select(func.count(ProviderConfig.id)).where((ProviderConfig.workspace_id == workspace_id) | (ProviderConfig.workspace_id.is_(None)), ProviderConfig.status == "active")) or 0)
    issue_rows = session.scalars(select(JudgeIssue).where(JudgeIssue.scene_id.in_(scene_ids)).order_by(JudgeIssue.id)).all() if scene_ids else []
    failure_categories = [
        AnalyticsFailureCategoryRead(issue_type=issue_type, count=count)
        for issue_type, count in sorted(Counter(issue.issue_type for issue in issue_rows).items())
    ]
    return WorkspaceAnalyticsRead(
        workspace_id=workspace_id,
        active_member_count=active_member_count,
        comment_count=comment_count,
        pending_approval_count=pending_approval_count,
        approval_pass_rate=approval_pass_rate,
        repair_acceptance_rate=repair_acceptance_rate,
        job_success_rate=job_success_rate,
        recent_event_count=recent_event_count,
        active_provider_count=active_provider_count,
        failure_categories=failure_categories,
        analytics_summary=(
            f"成员 {active_member_count}，评论 {comment_count}，待审批 {pending_approval_count}，"
            f"审批通过率 {approval_pass_rate:.2f}，修复采纳率 {repair_acceptance_rate:.2f}，任务成功率 {job_success_rate:.2f}。"
        ),
    )


def _safe_ratio(success: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(success / total, 4)
