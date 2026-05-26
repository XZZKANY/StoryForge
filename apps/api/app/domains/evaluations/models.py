from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book
    from app.domains.workspaces.models import Workspace


class EvaluationCase(IdMixin, TimestampMixin, Base):
    """评测用例保存基准输入和期望约束。"""

    __tablename__ = "evaluation_cases"

    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), index=True)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    case_name: Mapped[str] = mapped_column(String(255), nullable=False)
    case_type: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    input_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    expected_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    workspace: Mapped[Workspace | None] = relationship()
    book: Mapped[Book | None] = relationship()


class EvaluationRun(IdMixin, TimestampMixin, Base):
    """评测运行结果保存稳定指标和摘要。"""

    __tablename__ = "evaluation_runs"

    case_id: Mapped[int | None] = mapped_column(ForeignKey("evaluation_cases.id", ondelete="SET NULL"), index=True)
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), index=True)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="completed", server_default="completed")
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    summary: Mapped[str] = mapped_column(Text, nullable=False)

    case: Mapped[EvaluationCase | None] = relationship()
    workspace: Mapped[Workspace | None] = relationship()
    book: Mapped[Book | None] = relationship()
