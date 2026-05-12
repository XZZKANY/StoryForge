from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    from app.domains.books.models import Scene
    from app.domains.continuity.models import ScenePacket
    from app.domains.jobs.models import JobRun


class JudgeIssue(IdMixin, TimestampMixin, Base):
    """???????????????????????????"""

    __tablename__ = "judge_issues"

    scene_id: Mapped[int] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True, nullable=False)
    scene_packet_id: Mapped[int | None] = mapped_column(ForeignKey("scene_packets.id", ondelete="SET NULL"), index=True)
    job_run_id: Mapped[int | None] = mapped_column(ForeignKey("job_runs.id", ondelete="SET NULL"), index=True)
    issue_type: Mapped[str] = mapped_column(String(80), nullable=False)
    severity: Mapped[str] = mapped_column(String(50), nullable=False, default="medium", server_default="medium")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="open", server_default="open")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    scene: Mapped[Scene] = relationship(back_populates="judge_issues")
    scene_packet: Mapped[ScenePacket | None] = relationship(back_populates="judge_issues")
    job_run: Mapped[JobRun | None] = relationship(back_populates="judge_issues")
    repair_patches: Mapped[list[RepairPatch]] = relationship(back_populates="judge_issue", cascade="all, delete-orphan")


class RepairPatch(IdMixin, TimestampMixin, VersionMixin, Base):
    """???????????????????????????"""

    __tablename__ = "repair_patches"

    judge_issue_id: Mapped[int] = mapped_column(ForeignKey("judge_issues.id", ondelete="CASCADE"), index=True, nullable=False)
    scene_id: Mapped[int] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True, nullable=False)
    job_run_id: Mapped[int | None] = mapped_column(ForeignKey("job_runs.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="proposed", server_default="proposed")
    patch: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    rationale: Mapped[str | None] = mapped_column(Text)

    judge_issue: Mapped[JudgeIssue] = relationship(back_populates="repair_patches")
    scene: Mapped[Scene] = relationship(back_populates="repair_patches")
    job_run: Mapped[JobRun | None] = relationship(back_populates="repair_patches")
