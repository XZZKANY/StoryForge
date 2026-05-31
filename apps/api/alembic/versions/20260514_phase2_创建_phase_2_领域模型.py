"""创建 Phase 2 系列记忆领域模型

Revision ID: 20260514_phase2
Revises: 9f2b3c4d5e6f
Create Date: 2026-05-14 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260514_phase2"
down_revision: str | None = "9f2b3c4d5e6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """升级到当前 Phase 2 系列和系列记忆模型。"""

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
    op.create_index(op.f("ix_series_memories_lineage_key"), "series_memories", ["lineage_key"], unique=False)
    op.create_index(op.f("ix_series_memories_series_id"), "series_memories", ["series_id"], unique=False)
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
    op.create_index(
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
