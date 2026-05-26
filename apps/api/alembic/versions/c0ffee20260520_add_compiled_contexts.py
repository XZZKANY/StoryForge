"""新增 compiled contexts 最小持久化表

Revision ID: c0ffee20260520
Revises: c0ffee20260519
Create Date: 2026-05-19 01:05:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c0ffee20260520"
down_revision: str | None = "c0ffee20260519"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "compiled_contexts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("compiled_context_id", sa.String(length=80), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("chapter_id", sa.Integer(), nullable=False),
        sa.Column("scene_id", sa.Integer(), nullable=False),
        sa.Column("token_budget", sa.Integer(), nullable=False),
        sa.Column("used_tokens", sa.Integer(), nullable=False),
        sa.Column("dropped_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("injected_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("dropped_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("block_refs", sa.JSON(), nullable=False),
        sa.Column("budget_report", sa.JSON(), nullable=False),
        sa.Column("debug_summary", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chapter_id"], ["chapters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("compiled_context_id"),
    )
    op.create_index(op.f("ix_compiled_contexts_book_id"), "compiled_contexts", ["book_id"], unique=False)
    op.create_index(op.f("ix_compiled_contexts_chapter_id"), "compiled_contexts", ["chapter_id"], unique=False)
    op.create_index(op.f("ix_compiled_contexts_scene_id"), "compiled_contexts", ["scene_id"], unique=False)
    op.create_index(
        op.f("ix_compiled_contexts_compiled_context_id"),
        "compiled_contexts",
        ["compiled_context_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_compiled_contexts_compiled_context_id"), table_name="compiled_contexts")
    op.drop_index(op.f("ix_compiled_contexts_scene_id"), table_name="compiled_contexts")
    op.drop_index(op.f("ix_compiled_contexts_chapter_id"), table_name="compiled_contexts")
    op.drop_index(op.f("ix_compiled_contexts_book_id"), table_name="compiled_contexts")
    op.drop_table("compiled_contexts")
