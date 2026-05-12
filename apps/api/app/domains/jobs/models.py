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
    """?????????????????????????????"""

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
