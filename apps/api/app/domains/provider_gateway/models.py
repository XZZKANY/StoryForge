from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.workspaces.models import Workspace


class ProviderConfig(IdMixin, TimestampMixin, Base):
    """Provider 配置真相源，不直接保存真实密钥，只保存引用和能力。"""

    __tablename__ = "provider_configs"

    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    provider_name: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    capabilities: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    model_aliases: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    credential_ref: Mapped[str | None] = mapped_column(String(255))

    workspace: Mapped[Workspace | None] = relationship(back_populates="provider_configs")


from app.domains import workspaces as _workspaces_domain  # noqa: E402,F401
