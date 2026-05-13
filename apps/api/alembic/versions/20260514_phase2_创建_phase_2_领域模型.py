"""创建 Phase 2 领域模型

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
    """升级到 Phase 2 系列记忆、记忆快照和风格包应用模型。"""

    op.create_table(
        "series",
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
        sa.Column("premise", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "series_books",
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("inheritance_policy", sa.String(length=80), server_default="inherit_active", nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("series_id", "book_id", name="uq_series_books_series_book"),
    )
    op.create_index(op.f("ix_series_books_book_id"), "series_books", ["book_id"], unique=False)
    op.create_index(op.f("ix_series_books_series_id"), "series_books", ["series_id"], unique=False)
    op.create_table(
        "series_memory_snapshots",
        sa.Column("series_id", sa.Integer(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=True),
        sa.Column("source_continuity_record_id", sa.Integer(), nullable=True),
        sa.Column("job_run_id", sa.Integer(), nullable=True),
        sa.Column("snapshot_type", sa.String(length=80), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["job_run_id"], ["job_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_continuity_record_id"], ["continuity_records.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_series_memory_snapshots_book_id"), "series_memory_snapshots", ["book_id"], unique=False)
    op.create_index(op.f("ix_series_memory_snapshots_job_run_id"), "series_memory_snapshots", ["job_run_id"], unique=False)
    op.create_index(op.f("ix_series_memory_snapshots_series_id"), "series_memory_snapshots", ["series_id"], unique=False)
    op.create_index(
        op.f("ix_series_memory_snapshots_source_continuity_record_id"),
        "series_memory_snapshots",
        ["source_continuity_record_id"],
        unique=False,
    )
    op.create_table(
        "style_pack_applications",
        sa.Column("style_pack_asset_id", sa.Integer(), nullable=False),
        sa.Column("series_id", sa.Integer(), nullable=True),
        sa.Column("book_id", sa.Integer(), nullable=True),
        sa.Column("scene_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["style_pack_asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_style_pack_applications_book_id"), "style_pack_applications", ["book_id"], unique=False)
    op.create_index(op.f("ix_style_pack_applications_scene_id"), "style_pack_applications", ["scene_id"], unique=False)
    op.create_index(op.f("ix_style_pack_applications_series_id"), "style_pack_applications", ["series_id"], unique=False)
    op.create_index(
        op.f("ix_style_pack_applications_style_pack_asset_id"),
        "style_pack_applications",
        ["style_pack_asset_id"],
        unique=False,
    )


def downgrade() -> None:
    """回退 Phase 2 领域模型。"""

    op.drop_index(op.f("ix_style_pack_applications_style_pack_asset_id"), table_name="style_pack_applications")
    op.drop_index(op.f("ix_style_pack_applications_series_id"), table_name="style_pack_applications")
    op.drop_index(op.f("ix_style_pack_applications_scene_id"), table_name="style_pack_applications")
    op.drop_index(op.f("ix_style_pack_applications_book_id"), table_name="style_pack_applications")
    op.drop_table("style_pack_applications")
    op.drop_index(
        op.f("ix_series_memory_snapshots_source_continuity_record_id"),
        table_name="series_memory_snapshots",
    )
    op.drop_index(op.f("ix_series_memory_snapshots_series_id"), table_name="series_memory_snapshots")
    op.drop_index(op.f("ix_series_memory_snapshots_job_run_id"), table_name="series_memory_snapshots")
    op.drop_index(op.f("ix_series_memory_snapshots_book_id"), table_name="series_memory_snapshots")
    op.drop_table("series_memory_snapshots")
    op.drop_index(op.f("ix_series_books_series_id"), table_name="series_books")
    op.drop_index(op.f("ix_series_books_book_id"), table_name="series_books")
    op.drop_table("series_books")
    op.drop_table("series")
