from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    from app.domains.assets.models import Asset
    from app.domains.books.models import Book, Scene
    from app.domains.continuity.models import ContinuityRecord
    from app.domains.jobs.models import JobRun


class Series(IdMixin, TimestampMixin, Base):
    """系列根实体，承载跨作品记忆、世界观约束和风格复用边界。"""

    __tablename__ = "series"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    premise: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    books: Mapped[list[SeriesBook]] = relationship(back_populates="series", cascade="all, delete-orphan")
    memory_snapshots: Mapped[list[SeriesMemorySnapshot]] = relationship(
        back_populates="series",
        cascade="all, delete-orphan",
    )
    style_pack_applications: Mapped[list[StylePackApplication]] = relationship(back_populates="series")


class SeriesBook(IdMixin, TimestampMixin, Base):
    """记录作品在系列中的顺序和继承策略。"""

    __tablename__ = "series_books"
    __table_args__ = (UniqueConstraint("series_id", "book_id", name="uq_series_books_series_book"),)

    series_id: Mapped[int] = mapped_column(ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    inheritance_policy: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        default="inherit_active",
        server_default="inherit_active",
    )
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    series: Mapped[Series] = relationship(back_populates="books")
    book: Mapped[Book] = relationship(back_populates="series_links")


class SeriesMemorySnapshot(IdMixin, TimestampMixin, VersionMixin, Base):
    """系列记忆快照保存跨作品事实摘要，来源仍需指向结构化资产或连续性记录。"""

    __tablename__ = "series_memory_snapshots"

    series_id: Mapped[int] = mapped_column(ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    source_continuity_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("continuity_records.id", ondelete="SET NULL"),
        index=True,
    )
    job_run_id: Mapped[int | None] = mapped_column(ForeignKey("job_runs.id", ondelete="SET NULL"), index=True)
    snapshot_type: Mapped[str] = mapped_column(String(80), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    series: Mapped[Series] = relationship(back_populates="memory_snapshots")
    book: Mapped[Book | None] = relationship(back_populates="series_memory_snapshots")
    source_continuity_record: Mapped[ContinuityRecord | None] = relationship()
    job_run: Mapped[JobRun | None] = relationship()


class StylePackApplication(IdMixin, TimestampMixin, VersionMixin, Base):
    """记录风格包应用到系列、作品或场景后的版本化约束。"""

    __tablename__ = "style_pack_applications"

    style_pack_asset_id: Mapped[int] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    series_id: Mapped[int | None] = mapped_column(ForeignKey("series.id", ondelete="SET NULL"), index=True)
    book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), index=True)
    scene_id: Mapped[int | None] = mapped_column(ForeignKey("scenes.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    style_pack_asset: Mapped[Asset] = relationship()
    series: Mapped[Series | None] = relationship(back_populates="style_pack_applications")
    book: Mapped[Book | None] = relationship(back_populates="style_pack_applications")
    scene: Mapped[Scene | None] = relationship()


# 单独导入系列领域时，预加载关系目标模型，保证 configure_mappers 可独立执行。
from app.domains import assets as _assets_domain  # noqa: E402,F401
from app.domains import books as _books_domain  # noqa: E402,F401
from app.domains import continuity as _continuity_domain  # noqa: E402,F401
from app.domains import jobs as _jobs_domain  # noqa: E402,F401
