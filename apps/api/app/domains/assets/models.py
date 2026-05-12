from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    from app.domains.books.models import Book, Scene
    from app.domains.jobs.models import JobRun


class Asset(IdMixin, TimestampMixin, VersionMixin, Base):
    """创作资产真相源，覆盖设定、剧情、风格和草稿谱系等结构化内容。"""

    __tablename__ = "assets"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    scene_id: Mapped[int | None] = mapped_column(ForeignKey("scenes.id", ondelete="SET NULL"), index=True)
    asset_type: Mapped[str] = mapped_column(String(80), nullable=False)
    lineage_key: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    book: Mapped[Book] = relationship(back_populates="assets")
    scene: Mapped[Scene | None] = relationship(back_populates="assets")
    evidence_links: Mapped[list[EvidenceLink]] = relationship(back_populates="asset", cascade="all, delete-orphan")


class EvidenceLink(IdMixin, TimestampMixin, Base):
    """记录文本与资产、任务之间的证据关系，支撑后续解释和追溯。"""

    __tablename__ = "evidence_links"

    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), index=True, nullable=False)
    scene_id: Mapped[int | None] = mapped_column(ForeignKey("scenes.id", ondelete="SET NULL"), index=True)
    job_run_id: Mapped[int | None] = mapped_column(ForeignKey("job_runs.id", ondelete="SET NULL"), index=True)
    evidence_type: Mapped[str] = mapped_column(String(80), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text)

    asset: Mapped[Asset] = relationship(back_populates="evidence_links")
    scene: Mapped[Scene | None] = relationship(back_populates="evidence_links")
    job_run: Mapped[JobRun | None] = relationship(back_populates="evidence_links")


# 单独导入资产领域时，预加载关系目标模型，保证 configure_mappers 可独立执行。
from app.domains import books as _books_domain  # noqa: E402,F401
from app.domains import jobs as _jobs_domain  # noqa: E402,F401
