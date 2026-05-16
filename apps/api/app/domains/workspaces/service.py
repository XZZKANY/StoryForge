from __future__ import annotations

import re
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.workspaces.models import Workspace, WorkspaceMember
from app.domains.workspaces.schemas import WorkspaceCreate, WorkspaceMemberCreate


class WorkspaceNotFoundError(ValueError):
    """目标工作区不存在时抛出。"""


class WorkspaceSeatLimitError(ValueError):
    """工作区席位已满时抛出。"""


class WorkspaceConflictError(ValueError):
    """工作区 slug 冲突时抛出。"""


def create_workspace(session: Session, payload: WorkspaceCreate) -> Workspace:
    slug_base = _slugify(payload.title)
    slug = _next_available_slug(session, slug_base)
    workspace = Workspace(
        title=payload.title,
        slug=slug,
        description=payload.description,
        seat_limit=payload.seat_limit,
        status="active",
    )
    session.add(workspace)
    session.commit()
    session.refresh(workspace)
    return workspace


def list_workspaces(session: Session) -> Sequence[Workspace]:
    return session.scalars(select(Workspace).order_by(Workspace.id)).all()


def create_workspace_member(session: Session, workspace_id: int, payload: WorkspaceMemberCreate) -> WorkspaceMember:
    workspace = session.get(Workspace, workspace_id)
    if workspace is None:
        raise WorkspaceNotFoundError("工作区不存在。")
    active_members = session.scalar(
        select(func.count(WorkspaceMember.id)).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.status == "active",
        )
    ) or 0
    if payload.status == "active" and active_members >= workspace.seat_limit:
        raise WorkspaceSeatLimitError("工作区席位已满，无法继续添加活跃成员。")
    member = WorkspaceMember(
        workspace_id=workspace_id,
        display_name=payload.display_name,
        role=payload.role,
        status=payload.status,
    )
    session.add(member)
    session.commit()
    session.refresh(member)
    return member


def list_workspace_members(session: Session, workspace_id: int) -> Sequence[WorkspaceMember]:
    if session.get(Workspace, workspace_id) is None:
        raise WorkspaceNotFoundError("工作区不存在。")
    return session.scalars(
        select(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.id)
    ).all()


def require_active_member(session: Session, workspace_id: int, member_id: int) -> WorkspaceMember:
    member = session.get(WorkspaceMember, member_id)
    if member is None or member.workspace_id != workspace_id or member.status != "active":
        raise WorkspaceNotFoundError("成员不存在或未激活。")
    return member


def _slugify(title: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", title.strip().lower())
    return normalized.strip("-") or "workspace"


def _next_available_slug(session: Session, slug_base: str) -> str:
    existing = set(session.scalars(select(Workspace.slug).where(Workspace.slug.like(f"{slug_base}%"))).all())
    if slug_base not in existing:
        return slug_base
    index = 2
    while f"{slug_base}-{index}" in existing:
        index += 1
    return f"{slug_base}-{index}"
