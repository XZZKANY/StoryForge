from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """所有领域模型共享同一份元数据，确保迁移能完整读取表结构。"""


class IdMixin:
    """统一主键字段，便于各领域表保持一致的引用协议。"""

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)


class TimestampMixin:
    """统一审计时间字段，由数据库时间函数维护写入与更新时刻。"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class VersionMixin:
    """版本化资产使用单调整数，支撑后续比较、回滚和责任追溯。"""

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")