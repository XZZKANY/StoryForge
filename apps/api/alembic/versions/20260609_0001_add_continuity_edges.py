"""新增 continuity_edges 结构化连续性边表。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import context, op

revision: str = "20260609_0001"
down_revision: str | None = "20260608_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_exists(table_name: str) -> bool:
    """在线迁移检查表是否已存在，避免重复建表。"""

    if context.is_offline_mode():
        return False
    return inspect(op.get_bind()).has_table(table_name)


def _index_exists(table_name: str, index_name: str) -> bool:
    """在线迁移检查索引是否已存在。"""

    if context.is_offline_mode() or not _table_exists(table_name):
        return False
    indexes = inspect(op.get_bind()).get_indexes(table_name)
    return any(index["name"] == index_name for index in indexes)


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _index_exists(table_name, index_name):
        op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    if not _table_exists("continuity_edges"):
        op.create_table(
            "continuity_edges",
            sa.Column("book_id", sa.Integer(), nullable=False),
            sa.Column("edge_kind", sa.String(length=40), nullable=False),
            sa.Column("subject_ref", sa.String(length=160), nullable=False),
            sa.Column("predicate", sa.String(length=80), nullable=False),
            sa.Column("object_ref", sa.String(length=160), nullable=False),
            sa.Column("valid_from_chapter", sa.Integer(), server_default="1", nullable=False),
            sa.Column("valid_to_chapter", sa.Integer(), nullable=True),
            sa.Column("payload", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_continuity_edges_book_id", "continuity_edges", ["book_id"])
    _create_index_once("ix_continuity_edges_edge_kind", "continuity_edges", ["edge_kind"])


def downgrade() -> None:
    op.drop_index("ix_continuity_edges_edge_kind", table_name="continuity_edges")
    op.drop_index("ix_continuity_edges_book_id", table_name="continuity_edges")
    op.drop_table("continuity_edges")
