"""新增 story_state 事件日志与当前态投影表。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import context, op

revision: str = "20260630_0001"
down_revision: str | None = "20260623_0001"
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
    if not _table_exists("story_state_events"):
        op.create_table(
            "story_state_events",
            sa.Column("book_id", sa.Integer(), nullable=False),
            sa.Column("book_run_id", sa.Integer(), nullable=True),
            sa.Column("chapter_index", sa.Integer(), nullable=False),
            sa.Column("seq", sa.Integer(), nullable=False),
            sa.Column("change_type", sa.String(length=80), nullable=False),
            sa.Column("entity_kind", sa.String(length=80), nullable=False),
            sa.Column("entity_id", sa.String(length=160), nullable=False),
            sa.Column("object_id", sa.String(length=160), nullable=True),
            sa.Column("payload", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("grounding", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["book_run_id"], ["book_runs.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_story_state_events_book_id", "story_state_events", ["book_id"])
    _create_index_once("ix_story_state_events_book_run_id", "story_state_events", ["book_run_id"])
    _create_index_once("ix_story_state_events_chapter_index", "story_state_events", ["chapter_index"])
    _create_index_once("ix_story_state_events_change_type", "story_state_events", ["change_type"])
    _create_index_once("ix_story_state_events_entity_kind", "story_state_events", ["entity_kind"])
    _create_index_once("ix_story_state_events_entity_id", "story_state_events", ["entity_id"])
    _create_index_once("ix_story_state_events_object_id", "story_state_events", ["object_id"])

    if not _table_exists("story_state_ledgers"):
        op.create_table(
            "story_state_ledgers",
            sa.Column("book_id", sa.Integer(), nullable=False),
            sa.Column("book_run_id", sa.Integer(), nullable=True),
            sa.Column("entity_kind", sa.String(length=80), nullable=False),
            sa.Column("entity_id", sa.String(length=160), nullable=False),
            sa.Column("canonical_name", sa.String(length=255), nullable=False),
            sa.Column("aliases", sa.JSON(), server_default="[]", nullable=False),
            sa.Column("state", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("last_chapter", sa.Integer(), server_default="1", nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["book_run_id"], ["book_runs.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "book_id",
                "book_run_id",
                "entity_kind",
                "entity_id",
                name="uq_story_state_ledgers_scope_entity",
            ),
        )
    _create_index_once("ix_story_state_ledgers_book_id", "story_state_ledgers", ["book_id"])
    _create_index_once("ix_story_state_ledgers_book_run_id", "story_state_ledgers", ["book_run_id"])
    _create_index_once("ix_story_state_ledgers_entity_kind", "story_state_ledgers", ["entity_kind"])
    _create_index_once("ix_story_state_ledgers_entity_id", "story_state_ledgers", ["entity_id"])


def downgrade() -> None:
    op.drop_index("ix_story_state_ledgers_entity_id", table_name="story_state_ledgers")
    op.drop_index("ix_story_state_ledgers_entity_kind", table_name="story_state_ledgers")
    op.drop_index("ix_story_state_ledgers_book_run_id", table_name="story_state_ledgers")
    op.drop_index("ix_story_state_ledgers_book_id", table_name="story_state_ledgers")
    op.drop_table("story_state_ledgers")
    op.drop_index("ix_story_state_events_object_id", table_name="story_state_events")
    op.drop_index("ix_story_state_events_entity_id", table_name="story_state_events")
    op.drop_index("ix_story_state_events_entity_kind", table_name="story_state_events")
    op.drop_index("ix_story_state_events_change_type", table_name="story_state_events")
    op.drop_index("ix_story_state_events_chapter_index", table_name="story_state_events")
    op.drop_index("ix_story_state_events_book_run_id", table_name="story_state_events")
    op.drop_index("ix_story_state_events_book_id", table_name="story_state_events")
    op.drop_table("story_state_events")

