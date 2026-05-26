"""新增 story memory 最小持久化表

Revision ID: c0ffee20260519
Revises: 9f2b3c4d5e6f
Create Date: 2026-05-19 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c0ffee20260519"
down_revision: str | None = "9f2b3c4d5e6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "memory_atoms",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=160), nullable=False),
        sa.Column("fact_type", sa.String(length=80), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("valid_from_chapter", sa.Integer(), server_default="1", nullable=False),
        sa.Column("valid_to_chapter", sa.Integer(), nullable=True),
        sa.Column("immutable", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("confidence", sa.Float(), server_default="1", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("source_ref", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_memory_atoms_book_id"), "memory_atoms", ["book_id"], unique=False)
    op.create_index(op.f("ix_memory_atoms_entity_type"), "memory_atoms", ["entity_type"], unique=False)
    op.create_index(op.f("ix_memory_atoms_entity_id"), "memory_atoms", ["entity_id"], unique=False)
    op.create_index(op.f("ix_memory_atoms_fact_type"), "memory_atoms", ["fact_type"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_memory_atoms_fact_type"), table_name="memory_atoms")
    op.drop_index(op.f("ix_memory_atoms_entity_id"), table_name="memory_atoms")
    op.drop_index(op.f("ix_memory_atoms_entity_type"), table_name="memory_atoms")
    op.drop_index(op.f("ix_memory_atoms_book_id"), table_name="memory_atoms")
    op.drop_table("memory_atoms")
