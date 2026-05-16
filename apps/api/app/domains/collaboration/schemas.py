from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceCommentCreate(BaseModel):
    workspace_id: int = Field(gt=0)
    scene_id: int = Field(gt=0)
    member_id: int = Field(gt=0)
    body: str = Field(min_length=1)


class WorkspaceCommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    scene_id: int
    member_id: int
    body: str
    status: str
    created_at: datetime
    updated_at: datetime


class ApprovalRequestCreate(BaseModel):
    workspace_id: int = Field(gt=0)
    scene_id: int = Field(gt=0)
    requester_member_id: int = Field(gt=0)
    reviewer_member_id: int = Field(gt=0)
    summary: str = Field(min_length=1)


class ApprovalRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    scene_id: int
    requester_member_id: int
    reviewer_member_id: int
    status: str
    summary: str
    created_at: datetime
    updated_at: datetime


class ApprovalDecisionCreate(BaseModel):
    member_id: int = Field(gt=0)
    decision: str = Field(min_length=1, max_length=50)
    note: str | None = None


class ApprovalDecisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    approval_request_id: int
    member_id: int
    decision: str
    note: str | None
    created_at: datetime
    updated_at: datetime


class CollaborationTimelineItem(BaseModel):
    item_type: str
    item_id: int
    scene_id: int
    status: str
    summary: str
    created_at: datetime
