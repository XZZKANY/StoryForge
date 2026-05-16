from __future__ import annotations

from pydantic import BaseModel


class AnalyticsFailureCategoryRead(BaseModel):
    issue_type: str
    count: int


class WorkspaceAnalyticsRead(BaseModel):
    workspace_id: int
    active_member_count: int
    comment_count: int
    pending_approval_count: int
    approval_pass_rate: float
    repair_acceptance_rate: float
    job_success_rate: float
    recent_event_count: int
    active_provider_count: int
    failure_categories: list[AnalyticsFailureCategoryRead]
    analytics_summary: str
