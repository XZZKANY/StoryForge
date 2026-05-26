from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book, Chapter, Scene


class CompiledContextRecord(IdMixin, TimestampMixin, Base):
    """上下文编译快照的最小审计记录，不保存完整 prompt 全文。"""

    __tablename__ = "compiled_contexts"

    compiled_context_id: Mapped[str] = mapped_column(String(80), index=True, unique=True, nullable=False)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True, nullable=False)
    scene_id: Mapped[int] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True, nullable=False)
    token_budget: Mapped[int] = mapped_column(Integer, nullable=False)
    used_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    dropped_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    injected_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    dropped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    block_refs: Mapped[dict[str, list[dict[str, Any]]]] = mapped_column(JSON, nullable=False, default=dict)
    budget_report: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    debug_summary: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    book: Mapped[Book] = relationship()
    chapter: Mapped[Chapter] = relationship()
    scene: Mapped[Scene] = relationship()


