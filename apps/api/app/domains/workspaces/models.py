from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book
    from app.domains.collaboration.models import ApprovalRequest, WorkspaceComment
    from app.domains.commercial.models import WorkspaceSubscription
    from app.domains.events.models import EventLog
    from app.domains.provider_gateway.models import ProviderConfig


class Workspace(IdMixin, TimestampMixin, Base):
    """团队工作区是真相源外壳，负责聚合成员、作品和平台能力。"""

    __tablename__ = "workspaces"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    description: Mapped[str | None] = mapped_column(Text)
    seat_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    members: Mapped[list[WorkspaceMember]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    books: Mapped[list[Book]] = relationship(back_populates="workspace")
    subscriptions: Mapped[list[WorkspaceSubscription]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    comments: Mapped[list[WorkspaceComment]] = relationship(back_populates="workspace")
    approval_requests: Mapped[list[ApprovalRequest]] = relationship(back_populates="workspace")
    events: Mapped[list[EventLog]] = relationship(back_populates="workspace")
    provider_configs: Mapped[list[ProviderConfig]] = relationship(back_populates="workspace")


class WorkspaceMember(IdMixin, TimestampMixin, Base):
    """工作区成员记录协作角色和席位占用状态。"""

    __tablename__ = "workspace_members"

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="editor", server_default="editor")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    comments: Mapped[list[WorkspaceComment]] = relationship(back_populates="member")
    requested_approvals: Mapped[list[ApprovalRequest]] = relationship(
        back_populates="requester_member", foreign_keys="ApprovalRequest.requester_member_id"
    )
    review_approvals: Mapped[list[ApprovalRequest]] = relationship(
        back_populates="reviewer_member", foreign_keys="ApprovalRequest.reviewer_member_id"
    )
    decisions: Mapped[list[ApprovalDecision]] = relationship(back_populates="member")
    events: Mapped[list[EventLog]] = relationship(back_populates="member")


from app.domains.collaboration.models import ApprovalDecision  # noqa: E402
from app.domains import books as _books_domain  # noqa: E402,F401
from app.domains import collaboration as _collaboration_domain  # noqa: E402,F401
from app.domains import commercial as _commercial_domain  # noqa: E402,F401
from app.domains import events as _events_domain  # noqa: E402,F401
from app.domains import provider_gateway as _provider_domain  # noqa: E402,F401
