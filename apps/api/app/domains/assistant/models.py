from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.artifacts.models import Artifact
    from app.domains.blueprints.models import BookBlueprint
    from app.domains.book_runs.models import BookRun


class AssistantSession(IdMixin, TimestampMixin, Base):
    """Assistant 会话只保存对话与业务引用，不保存任何 Provider 凭据。"""

    __tablename__ = "assistant_sessions"

    title: Mapped[str] = mapped_column(String(160), nullable=False)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    blueprint_id: Mapped[int | None] = mapped_column(ForeignKey("book_blueprints.id", ondelete="SET NULL"), index=True)
    book_run_id: Mapped[int | None] = mapped_column(ForeignKey("book_runs.id", ondelete="SET NULL"), index=True)
    artifact_id: Mapped[int | None] = mapped_column(ForeignKey("artifacts.id", ondelete="SET NULL"), index=True)

    messages: Mapped[list[AssistantMessage]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="AssistantMessage.id",
    )
    tool_calls: Mapped[list[AssistantToolCall]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="AssistantToolCall.id",
    )
    blueprint: Mapped[BookBlueprint | None] = relationship()
    book_run: Mapped[BookRun | None] = relationship()
    artifact: Mapped[Artifact | None] = relationship()


class AssistantMessage(IdMixin, TimestampMixin, Base):
    """Assistant 消息用于追溯用户意图与工具执行摘要。"""

    __tablename__ = "assistant_messages"

    session_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    session: Mapped[AssistantSession] = relationship(back_populates="messages")


class AssistantToolCall(IdMixin, TimestampMixin, Base):
    """Assistant 工具调用事实源，用短摘要追溯执行状态和业务对象。"""

    __tablename__ = "assistant_tool_calls"

    session_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    tool_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    input_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text)
    related_type: Mapped[str | None] = mapped_column(String(80))
    related_id: Mapped[int | None] = mapped_column(index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    session: Mapped[AssistantSession] = relationship(back_populates="tool_calls")
