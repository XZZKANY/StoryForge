from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book, Scene
    from app.domains.jobs.models import JobRun
    from app.domains.prompt_packs.models import PromptPack
    from app.domains.workspaces.models import Workspace


class ModelRun(IdMixin, TimestampMixin, Base):
    """模型运行日志是后续成本、实验和回放的基础事实。"""

    __tablename__ = "model_runs"

    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), index=True)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    scene_id: Mapped[int | None] = mapped_column(ForeignKey("scenes.id", ondelete="SET NULL"), index=True)
    job_run_id: Mapped[int | None] = mapped_column(ForeignKey("job_runs.id", ondelete="SET NULL"), index=True)
    prompt_pack_id: Mapped[int | None] = mapped_column(ForeignKey("prompt_packs.id", ondelete="SET NULL"), index=True)
    provider_name: Mapped[str] = mapped_column(String(80), nullable=False)
    model_name: Mapped[str] = mapped_column(String(120), nullable=False)
    capability: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="completed", server_default="completed")
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    token_usage: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    input_summary: Mapped[str] = mapped_column(Text, nullable=False)
    output_summary: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    workspace: Mapped[Workspace | None] = relationship()
    book: Mapped[Book | None] = relationship()
    scene: Mapped[Scene | None] = relationship()
    job_run: Mapped[JobRun | None] = relationship()
    prompt_pack: Mapped[PromptPack | None] = relationship()
