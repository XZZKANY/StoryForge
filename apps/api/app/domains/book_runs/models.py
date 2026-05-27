from __future__ import annotations

from sqlalchemy import JSON, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin
from app.domains.blueprints.models import BookBlueprint
from app.domains.books.models import Book


class BookRun(IdMixin, TimestampMixin, Base):
    """BookRun 记录整本书自动生成进度，9A 只保存最小运行状态。"""

    __tablename__ = "book_runs"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    blueprint_id: Mapped[int] = mapped_column(ForeignKey("book_blueprints.id", ondelete="CASCADE"), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="running", server_default="running")
    current_chapter_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    total_chapters: Mapped[int] = mapped_column(Integer, nullable=False)
    progress: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    checkpoint: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    token_budget: Mapped[int | None] = mapped_column(Integer)
    tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    time_budget_sec: Mapped[int | None] = mapped_column(Integer)
    elapsed_time_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    chapter_budget: Mapped[int | None] = mapped_column(Integer)
    estimated_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    cost_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    book: Mapped[Book] = relationship()
    blueprint: Mapped[BookBlueprint] = relationship()
