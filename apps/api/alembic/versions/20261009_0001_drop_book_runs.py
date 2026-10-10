"""Drop the retired BookRun table and the five foreign keys pointing at it.

自动整书链已于 2026-10-09 退役（PR #272），`book_runs` 表与指向它的 5 个
`book_run_id` 外键列随之失去载体。story_state_ledgers 的唯一约束含 book_run_id，
一并收敛为 (book_id, entity_kind, entity_id)。

SQLite 侧 drop_column / 约束变更一律走 batch_alter_table（见 CLAUDE.md §6）；
downgrade 复原表、5 个列、索引与原唯一约束，但不恢复数据（表本就为空）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "20261009_0001"
down_revision: str | None = "20261008_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMN = "book_run_id"
_LEDGERS = "story_state_ledgers"
_UNIQUE = "uq_story_state_ledgers_scope_entity"
# (表名, 索引名)；ledgers 单列出来是因为它还要换唯一约束。
_PLAIN_TABLES = (
    ("agent_runs", "ix_agent_runs_book_run_id"),
    ("assistant_sessions", "ix_assistant_sessions_book_run_id"),
    ("model_runs", "ix_model_runs_book_run_id"),
    ("story_state_events", "ix_story_state_events_book_run_id"),
)
_LEDGERS_INDEX = "ix_story_state_ledgers_book_run_id"


def _has_column(table: str) -> bool:
    # offline（--sql 生成脚本）拿不到真连接，一律当作存在、无条件发 DDL。
    if context.is_offline_mode():
        return True
    if not _has_table(table):
        return False
    return _COLUMN in {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _has_index(table: str, index: str) -> bool:
    if context.is_offline_mode():
        return True
    if not _has_table(table):
        return False
    return index in {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table)}


def _has_table(table: str) -> bool:
    # create_all 建的新库里 book_runs 从一开始就不存在（模型已删），stamp 之后再 upgrade
    # 会走到这条迁移；此处必须按「本就没有」跳过，而不是硬 drop。
    if context.is_offline_mode():
        return True
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    for table, index in (*_PLAIN_TABLES, (_LEDGERS, _LEDGERS_INDEX)):
        if _has_index(table, index):
            op.drop_index(index, table_name=table)

    for table, _ in _PLAIN_TABLES:
        if _has_column(table):
            with op.batch_alter_table(table) as batch:
                batch.drop_column(_COLUMN)

    if _has_column(_LEDGERS):
        with op.batch_alter_table(_LEDGERS) as batch:
            batch.drop_constraint(_UNIQUE, type_="unique")
            batch.drop_column(_COLUMN)
            batch.create_unique_constraint(_UNIQUE, ["book_id", "entity_kind", "entity_id"])

    if _has_table("book_runs"):
        for index in ("ix_book_runs_blueprint_id", "ix_book_runs_book_id"):
            if _has_index("book_runs", index):
                op.drop_index(index, table_name="book_runs")
        op.drop_table("book_runs")


def downgrade() -> None:
    op.create_table(
        "book_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("blueprint_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=50), server_default="running", nullable=False),
        sa.Column("current_chapter_index", sa.Integer(), server_default="1", nullable=False),
        sa.Column("total_chapters", sa.Integer(), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("checkpoint", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("token_budget", sa.Integer(), nullable=True),
        sa.Column("tokens_used", sa.Integer(), server_default="0", nullable=False),
        sa.Column("time_budget_sec", sa.Integer(), nullable=True),
        sa.Column("elapsed_time_sec", sa.Integer(), server_default="0", nullable=False),
        sa.Column("total_latency_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("max_latency_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("avg_latency_ms", sa.Integer(), server_default="0", nullable=False),
        sa.Column("chapter_budget", sa.Integer(), nullable=True),
        sa.Column("estimated_cost", sa.Float(), server_default="0", nullable=False),
        sa.Column("cost_summary", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blueprint_id"], ["book_blueprints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_book_runs_book_id"), "book_runs", ["book_id"], unique=False)
    op.create_index(op.f("ix_book_runs_blueprint_id"), "book_runs", ["blueprint_id"], unique=False)

    with op.batch_alter_table(_LEDGERS) as batch:
        batch.drop_constraint(_UNIQUE, type_="unique")
        batch.add_column(sa.Column(_COLUMN, sa.Integer(), nullable=True))
        batch.create_foreign_key(
            f"fk_{_LEDGERS}_{_COLUMN}_book_runs", "book_runs", [_COLUMN], ["id"], ondelete="SET NULL"
        )
        batch.create_unique_constraint(_UNIQUE, ["book_id", _COLUMN, "entity_kind", "entity_id"])
    op.create_index(_LEDGERS_INDEX, _LEDGERS, [_COLUMN], unique=False)

    for table, index in _PLAIN_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column(_COLUMN, sa.Integer(), nullable=True))
            batch.create_foreign_key(
                f"fk_{table}_{_COLUMN}_book_runs", "book_runs", [_COLUMN], ["id"], ondelete="SET NULL"
            )
        op.create_index(index, table, [_COLUMN], unique=False)
