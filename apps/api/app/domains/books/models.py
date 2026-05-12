from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.assets.models import Asset, EvidenceLink
    from app.domains.continuity.models import ContinuityRecord, ScenePacket
    from app.domains.jobs.models import JobRun
    from app.domains.judge.models import JudgeIssue, RepairPatch


class Book(IdMixin, TimestampMixin, Base):
    """??????????????????????????"""

    __tablename__ = "books"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft", server_default="draft")
    premise: Mapped[str | None] = mapped_column(Text)

    chapters: Mapped[list[Chapter]] = relationship(back_populates="book", cascade="all, delete-orphan")
    assets: Mapped[list[Asset]] = relationship(back_populates="book")
    continuity_records: Mapped[list[ContinuityRecord]] = relationship(back_populates="book")
    job_runs: Mapped[list[JobRun]] = relationship(back_populates="book")


class Chapter(IdMixin, TimestampMixin, Base):
    """?????????????????????????"""

    __tablename__ = "chapters"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="planned", server_default="planned")
    summary: Mapped[str | None] = mapped_column(Text)

    book: Mapped[Book] = relationship(back_populates="chapters")
    scenes: Mapped[list[Scene]] = relationship(back_populates="chapter", cascade="all, delete-orphan")


class Scene(IdMixin, TimestampMixin, Base):
    """??????????????????????????????"""

    __tablename__ = "scenes"

    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="planned", server_default="planned")
    content: Mapped[str | None] = mapped_column(Text)

    chapter: Mapped[Chapter] = relationship(back_populates="scenes")
    assets: Mapped[list[Asset]] = relationship(back_populates="scene")
    continuity_records: Mapped[list[ContinuityRecord]] = relationship(back_populates="scene")
    scene_packets: Mapped[list[ScenePacket]] = relationship(back_populates="scene")
    judge_issues: Mapped[list[JudgeIssue]] = relationship(back_populates="scene")
    repair_patches: Mapped[list[RepairPatch]] = relationship(back_populates="scene")
    evidence_links: Mapped[list[EvidenceLink]] = relationship(back_populates="scene")
    job_runs: Mapped[list[JobRun]] = relationship(back_populates="scene")
