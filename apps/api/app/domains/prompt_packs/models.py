from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book
    from app.domains.workspaces.models import Workspace


class PromptPack(IdMixin, TimestampMixin, VersionMixin, Base):
    """Prompt Pack 保存可版本化复用的模板集合。"""

    __tablename__ = "prompt_packs"

    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), index=True)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    pack_type: Mapped[str] = mapped_column(String(80), nullable=False)
    lineage_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    workspace: Mapped[Workspace | None] = relationship()
    book: Mapped[Book | None] = relationship()
