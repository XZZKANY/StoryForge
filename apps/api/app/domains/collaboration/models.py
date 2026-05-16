from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Scene
    from app.domains.workspaces.models import Workspace, WorkspaceMember


class WorkspaceComment(IdMixin, TimestampMixin, Base):
    """评论用于多人对场景进行协作反馈。"""

    __tablename__ = "workspace_comments"

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    scene_id: Mapped[int] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True, nullable=False)
    member_id: Mapped[int] = mapped_column(ForeignKey("workspace_members.id", ondelete="CASCADE"), index=True, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="open", server_default="open")

    workspace: Mapped[Workspace] = relationship(back_populates="comments")
    scene: Mapped[Scene] = relationship()
    member: Mapped[WorkspaceMember] = relationship(back_populates="comments")


class ApprovalRequest(IdMixin, TimestampMixin, Base):
    """审批请求表示需要他人确认的版本审阅动作。"""

    __tablename__ = "approval_requests"

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    scene_id: Mapped[int] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True, nullable=False)
    requester_member_id: Mapped[int] = mapped_column(ForeignKey("workspace_members.id", ondelete="CASCADE"), index=True, nullable=False)
    reviewer_member_id: Mapped[int] = mapped_column(ForeignKey("workspace_members.id", ondelete="CASCADE"), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending", server_default="pending")
    summary: Mapped[str] = mapped_column(Text, nullable=False)

    workspace: Mapped[Workspace] = relationship(back_populates="approval_requests")
    scene: Mapped[Scene] = relationship()
    requester_member: Mapped[WorkspaceMember] = relationship(
        back_populates="requested_approvals", foreign_keys=[requester_member_id]
    )
    reviewer_member: Mapped[WorkspaceMember] = relationship(
        back_populates="review_approvals", foreign_keys=[reviewer_member_id]
    )
    decisions: Mapped[list[ApprovalDecision]] = relationship(back_populates="approval_request", cascade="all, delete-orphan")


class ApprovalDecision(IdMixin, TimestampMixin, Base):
    """审批决策记录批准或打回，并保留备注。"""

    __tablename__ = "approval_decisions"

    approval_request_id: Mapped[int] = mapped_column(ForeignKey("approval_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    member_id: Mapped[int] = mapped_column(ForeignKey("workspace_members.id", ondelete="CASCADE"), index=True, nullable=False)
    decision: Mapped[str] = mapped_column(String(50), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    approval_request: Mapped[ApprovalRequest] = relationship(back_populates="decisions")
    member: Mapped[WorkspaceMember] = relationship(back_populates="decisions")


from app.domains import books as _books_domain  # noqa: E402,F401
from app.domains import workspaces as _workspaces_domain  # noqa: E402,F401
