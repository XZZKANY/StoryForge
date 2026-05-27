from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book


class BookBlueprint(IdMixin, TimestampMixin, VersionMixin, Base):
    """全书蓝图锁定整本书的立意、语气、规模和章节约束。"""

    __tablename__ = "book_blueprints"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    premise: Mapped[str] = mapped_column(Text, nullable=False)
    tone: Mapped[str] = mapped_column(String(255), nullable=False)
    target_word_count: Mapped[int] = mapped_column(Integer, nullable=False)
    target_chapter_count: Mapped[int] = mapped_column(Integer, nullable=False)
    chapter_word_count_min: Mapped[int] = mapped_column(Integer, nullable=False)
    chapter_word_count_max: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft", server_default="draft")
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)

    book: Mapped[Book] = relationship()
