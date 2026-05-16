from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.workspaces.models import Workspace


class WorkspaceSubscription(IdMixin, TimestampMixin, Base):
    """工作区套餐与限额，为后续商业化和控制面板留出真相源。"""

    __tablename__ = "workspace_subscriptions"

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False)
    plan_code: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    seat_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    monthly_job_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    monthly_token_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    monthly_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)

    workspace: Mapped[Workspace] = relationship(back_populates="subscriptions")


from app.domains import workspaces as _workspaces_domain  # noqa: E402,F401
