from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book
    from app.domains.series.models import Series


class RetrievalSource(IdMixin, TimestampMixin, Base):
    """资料源是真实检索内容的登记入口。"""

    __tablename__ = "retrieval_sources"

    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    series_id: Mapped[int | None] = mapped_column(ForeignKey("series.id", ondelete="SET NULL"), index=True)
    source_type: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    chunks: Mapped[list[RetrievalChunk]] = relationship(back_populates="source", cascade="all, delete-orphan")
    book: Mapped[Book | None] = relationship()
    series: Mapped[Series | None] = relationship()

    @property
    def chunk_count(self) -> int:
        return len(self.chunks)


class RetrievalChunk(IdMixin, TimestampMixin, Base):
    """资料源的切片结果，只保存检索加速所需的轻量信息。"""

    __tablename__ = "retrieval_chunks"

    source_id: Mapped[int] = mapped_column(ForeignKey("retrieval_sources.id", ondelete="CASCADE"), index=True, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    keywords: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    embedding: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    source: Mapped[RetrievalSource] = relationship(back_populates="chunks")


class RetrievalRefreshRun(IdMixin, TimestampMixin, Base):
    """Embedding 刷新任务记录。"""

    __tablename__ = "retrieval_refresh_runs"

    source_id: Mapped[int | None] = mapped_column(ForeignKey("retrieval_sources.id", ondelete="SET NULL"), index=True)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    series_id: Mapped[int | None] = mapped_column(ForeignKey("series.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="completed", server_default="completed")
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    source: Mapped[RetrievalSource | None] = relationship()
    book: Mapped[Book | None] = relationship()
    series: Mapped[Series | None] = relationship()


from app.domains import books as _books_domain  # noqa: E402,F401
from app.domains import series as _series_domain  # noqa: E402,F401

