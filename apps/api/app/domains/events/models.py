from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book, Scene
    from app.domains.workspaces.models import Workspace, WorkspaceMember


class EventLog(IdMixin, TimestampMixin, Base):
    """事件流用于沉淀可审计、可聚合的平台事件。"""

    __tablename__ = "event_logs"

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    scene_id: Mapped[int | None] = mapped_column(ForeignKey("scenes.id", ondelete="SET NULL"), index=True)
    member_id: Mapped[int | None] = mapped_column(ForeignKey("workspace_members.id", ondelete="SET NULL"), index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    workspace: Mapped[Workspace] = relationship(back_populates="events")
    book: Mapped[Book | None] = relationship()
    scene: Mapped[Scene | None] = relationship()
    member: Mapped[WorkspaceMember | None] = relationship(back_populates="events")


from app.domains import books as _books_domain  # noqa: E402,F401
from app.domains import workspaces as _workspaces_domain  # noqa: E402,F401
