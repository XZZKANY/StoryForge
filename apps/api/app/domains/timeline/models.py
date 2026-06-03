from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book, Chapter


class TimelineEventRecord(IdMixin, TimestampMixin, Base):
    """时间线事件真相源，记录作品内可排序、可追溯的剧情事实。"""

    __tablename__ = "timeline_events"

    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    volume_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True, nullable=False)
    time_order: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_refs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    book: Mapped[Book] = relationship()
    chapter: Mapped[Chapter] = relationship()
