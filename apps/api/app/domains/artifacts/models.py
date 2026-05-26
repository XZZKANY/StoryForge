from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book
    from app.domains.workspaces.models import Workspace


class Artifact(IdMixin, TimestampMixin, VersionMixin, Base):
    """制品元数据记录对象存储中的产物引用与谱系。"""

    __tablename__ = "artifacts"

    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), index=True)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    artifact_type: Mapped[str] = mapped_column(String(80), nullable=False)
    lineage_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    storage_uri: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    workspace: Mapped[Workspace | None] = relationship()
    book: Mapped[Book | None] = relationship()



