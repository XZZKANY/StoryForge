"""创建 Phase 2 系列记忆领域模型

Revision ID: 20260514_phase2
Revises: 9f2b3c4d5e6f
Create Date: 2026-05-14 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import context, op

revision: str = "20260514_phase2"
down_revision: str | None = "9f2b3c4d5e6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_exists(table_name: str) -> bool:
    """在线迁移检查表是否已由历史 backfill 建立。"""

    if context.is_offline_mode():
        return False
    return inspect(op.get_bind()).has_table(table_name)


def _index_exists(table_name: str, index_name: str) -> bool:
    """在线迁移检查索引是否已存在。"""

    if context.is_offline_mode() or not _table_exists(table_name):
        return False
    indexes = inspect(op.get_bind()).get_indexes(table_name)
    return any(index["name"] == index_name for index in indexes)


def _create_index_once(index_name: str, table_name: str, columns: list[str], *, unique: bool = False) -> None:
    """只在缺失时创建索引，兼容已跑过 backfill 的开发库。"""

    if not _index_exists(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    """升级到当前 Phase 2 系列和系列记忆模型。"""

    if not _table_exists("series"):
        op.create_table(
            "series",
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _table_exists("series_memories"):
        op.create_table(
            "series_memories",
            sa.Column("series_id", sa.Integer(), nullable=False),
            sa.Column("memory_type", sa.String(length=80), nullable=False),
            sa.Column("lineage_key", sa.String(length=80), nullable=False),
            sa.Column("subject", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(op.f("ix_series_memories_lineage_key"), "series_memories", ["lineage_key"], unique=False)
    _create_index_once(op.f("ix_series_memories_series_id"), "series_memories", ["series_id"], unique=False)
    if not _table_exists("series_memory_evidence"):
        op.create_table(
            "series_memory_evidence",
            sa.Column("memory_id", sa.Integer(), nullable=False),
            sa.Column("evidence_type", sa.String(length=80), nullable=False),
            sa.Column("source_ref", sa.String(length=255), nullable=False),
            sa.Column("rationale", sa.Text(), nullable=True),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["memory_id"], ["series_memories.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        op.f("ix_series_memory_evidence_memory_id"),
        "series_memory_evidence",
        ["memory_id"],
        unique=False,
    )


def downgrade() -> None:
    """回退 Phase 2 系列记忆领域模型。"""

    op.drop_index(op.f("ix_series_memory_evidence_memory_id"), table_name="series_memory_evidence")
    op.drop_table("series_memory_evidence")
    op.drop_index(op.f("ix_series_memories_series_id"), table_name="series_memories")
    op.drop_index(op.f("ix_series_memories_lineage_key"), table_name="series_memories")
    op.drop_table("series_memories")
    op.drop_table("series")
