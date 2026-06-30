from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    from app.domains.book_runs.models import BookRun
    from app.domains.books.models import Book


class StoryStateEvent(IdMixin, TimestampMixin, Base):
    """逐章故事状态变化事件，作为 append-only 审计真相源。"""

    __tablename__ = "story_state_events"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    book_run_id: Mapped[int | None] = mapped_column(ForeignKey("book_runs.id", ondelete="SET NULL"), index=True)
    chapter_index: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    change_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_kind: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    object_id: Mapped[str | None] = mapped_column(String(160), index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    grounding: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")

    book: Mapped[Book] = relationship()
    book_run: Mapped[BookRun | None] = relationship()


class StoryStateLedger(IdMixin, TimestampMixin, VersionMixin, Base):
    """故事状态当前态投影，可由 StoryStateEvent 随时重建。"""

    __tablename__ = "story_state_ledgers"
    __table_args__ = (
        UniqueConstraint(
            "book_id",
            "book_run_id",
            "entity_kind",
            "entity_id",
            name="uq_story_state_ledgers_scope_entity",
        ),
    )

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    book_run_id: Mapped[int | None] = mapped_column(ForeignKey("book_runs.id", ondelete="SET NULL"), index=True)
    entity_kind: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    canonical_name: Mapped[str] = mapped_column(String(255), nullable=False)
    aliases: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    state: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    last_chapter: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    book: Mapped[Book] = relationship()
    book_run: Mapped[BookRun | None] = relationship()

