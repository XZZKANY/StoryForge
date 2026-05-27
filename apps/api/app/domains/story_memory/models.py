from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book, Chapter


class MemoryAtomRecord(IdMixin, TimestampMixin, Base):
    """长效记忆事实的最小持久化记录。"""

    __tablename__ = "memory_atoms"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    fact_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    valid_from_chapter: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    valid_to_chapter: Mapped[int | None] = mapped_column(Integer)
    immutable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0, server_default="1")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    source_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    source_chapter_id: Mapped[int | None] = mapped_column(
        ForeignKey("chapters.id", ondelete="SET NULL"),
        index=True,
    )

    book: Mapped[Book] = relationship()
    source_chapter: Mapped[Chapter | None] = relationship()
