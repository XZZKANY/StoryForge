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
    """长篇作品的根实体，承载章节、资产和长任务的业务归属。"""

    __tablename__ = "books"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft", server_default="draft")
    premise: Mapped[str | None] = mapped_column(Text)

    chapters: Mapped[list[Chapter]] = relationship(back_populates="book", cascade="all, delete-orphan")
    assets: Mapped[list[Asset]] = relationship(back_populates="book")
    continuity_records: Mapped[list[ContinuityRecord]] = relationship(back_populates="book")
    job_runs: Mapped[list[JobRun]] = relationship(back_populates="book")


class Chapter(IdMixin, TimestampMixin, Base):
    """章节实体记录书内顺序和生成进度，是场景列表的父级。"""

    __tablename__ = "chapters"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="planned", server_default="planned")
    summary: Mapped[str | None] = mapped_column(Text)

    book: Mapped[Book] = relationship(back_populates="chapters")
    scenes: Mapped[list[Scene]] = relationship(back_populates="chapter", cascade="all, delete-orphan")


class Scene(IdMixin, TimestampMixin, Base):
    """场景是真相源写作粒度，连接正文、检索包、评审问题和修复补丁。"""

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


# SQLAlchemy 的字符串关系解析依赖类注册表；单独导入本模块时也要注册相关领域模型。
from app.domains import assets as _assets_domain  # noqa: E402,F401
from app.domains import continuity as _continuity_domain  # noqa: E402,F401
from app.domains import jobs as _jobs_domain  # noqa: E402,F401
from app.domains import judge as _judge_domain  # noqa: E402,F401