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
    """连续性记录保存设定、剧情和风格状态，供生成与精修共同回写。"""

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
    """场景检索包固定生成输入槽位，避免向量检索结果直接成为业务真相源。"""

    __tablename__ = "scene_packets"

    scene_id: Mapped[int] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"), index=True, nullable=False)
    job_run_id: Mapped[int | None] = mapped_column(ForeignKey("job_runs.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="assembled", server_default="assembled")
    packet: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)

    scene: Mapped[Scene] = relationship(back_populates="scene_packets")
    job_run: Mapped[JobRun | None] = relationship(back_populates="scene_packets")
    judge_issues: Mapped[list[JudgeIssue]] = relationship(back_populates="scene_packet")


# 单独导入连续性领域时，预加载关系目标模型，保证 configure_mappers 可独立执行。
from app.domains import books as _books_domain  # noqa: E402,F401
from app.domains import jobs as _jobs_domain  # noqa: E402,F401
from app.domains import judge as _judge_domain  # noqa: E402,F401