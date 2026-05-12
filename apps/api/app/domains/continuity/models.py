from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book, Scene
    from app.domains.jobs.models import JobRun
    from app.domains.judge.models import JudgeIssue


class ContinuityRecord(IdMixin, TimestampMixin, VersionMixin, Base):
    """?????????????????????????????"""

    __tablename__ = "continuity_records"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    scene_id: Mapped[int | None] = mapped_column(ForeignKey("scenes.id", ondelete="SET NULL"), index=True)
    record_type: Mapped[str] = mapped_column(String(80), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    book: Mapped[Book] = relationship(back_populates="continuity_records")
    scene: Mapped[Scene | None] = relationship(back_populates="continuity_records")


class ScenePacket(IdMixin, TimestampMixin, VersionMixin, Base):
    """????????????????????????????????"""

    __tablename__ = "scene_packets"

    scene_id: Mapped[int] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True, nullable=False)
    job_run_id: Mapped[int | None] = mapped_column(ForeignKey("job_runs.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="assembled", server_default="assembled")
    packet: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)

    scene: Mapped[Scene] = relationship(back_populates="scene_packets")
    job_run: Mapped[JobRun | None] = relationship(back_populates="scene_packets")
    judge_issues: Mapped[list[JudgeIssue]] = relationship(back_populates="scene_packet")
