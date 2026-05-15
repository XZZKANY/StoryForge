from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin, VersionMixin

if TYPE_CHECKING:
    pass


class Series(IdMixin, TimestampMixin, Base):
    """系列根实体承载跨作品记忆，避免把全局设定散落到单本作品。"""

    __tablename__ = "series"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    description: Mapped[str | None] = mapped_column(Text)

    memories: Mapped[list[SeriesMemory]] = relationship(back_populates="series", cascade="all, delete-orphan")


class SeriesMemory(IdMixin, TimestampMixin, VersionMixin, Base):
    """系列级记忆按谱系保留历史版本，供跨书世界观和质量看板复用。"""

    __tablename__ = "series_memories"

    series_id: Mapped[int] = mapped_column(ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False)
    memory_type: Mapped[str] = mapped_column(String(80), nullable=False)
    lineage_key: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    series: Mapped[Series] = relationship(back_populates="memories")
    evidence: Mapped[list[SeriesMemoryEvidence]] = relationship(back_populates="memory", cascade="all, delete-orphan")


class SeriesMemoryEvidence(IdMixin, TimestampMixin, Base):
    """记录系列记忆的来源，支撑跨书设定的审计与解释。"""

    __tablename__ = "series_memory_evidence"

    memory_id: Mapped[int] = mapped_column(
        ForeignKey("series_memories.id", ondelete="CASCADE"), index=True, nullable=False
    )
    evidence_type: Mapped[str] = mapped_column(String(80), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text)

    memory: Mapped[SeriesMemory] = relationship(back_populates="evidence")
