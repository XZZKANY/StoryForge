from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.assets.models import EvidenceLink
    from app.domains.books.models import Book, Scene
    from app.domains.continuity.models import ScenePacket
    from app.domains.judge.models import JudgeIssue, RepairPatch


class JobRun(IdMixin, TimestampMixin, Base):
    """任务中心运行记录保存长任务进度、重试上下文和断点续跑状态。"""

    __tablename__ = "job_runs"

    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    scene_id: Mapped[int | None] = mapped_column(ForeignKey("scenes.id", ondelete="SET NULL"), index=True)
    job_type: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="queued", server_default="queued")
    progress: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text)

    book: Mapped[Book | None] = relationship(back_populates="job_runs")
    scene: Mapped[Scene | None] = relationship(back_populates="job_runs")
    scene_packets: Mapped[list[ScenePacket]] = relationship(back_populates="job_run")
    judge_issues: Mapped[list[JudgeIssue]] = relationship(back_populates="job_run")
    repair_patches: Mapped[list[RepairPatch]] = relationship(back_populates="job_run")
    evidence_links: Mapped[list[EvidenceLink]] = relationship(back_populates="job_run")


# 单独导入任务领域时，预加载关系目标模型，保证 configure_mappers 可独立执行。
from app.domains import assets as _assets_domain  # noqa: E402,F401
from app.domains import books as _books_domain  # noqa: E402,F401
from app.domains import continuity as _continuity_domain  # noqa: E402,F401
from app.domains import judge as _judge_domain  # noqa: E402,F401