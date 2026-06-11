"""补充 ModelRun 与 BookRun 可观测性字段。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import context, op

revision: str = "20260610_0001"
down_revision: str | None = "20260609_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_exists(table_name: str) -> bool:
    """在线迁移检查表是否存在，便于本地补偿验证重复执行。"""

    if context.is_offline_mode():
        return True
    return inspect(op.get_bind()).has_table(table_name)


def _column_exists(table_name: str, column_name: str) -> bool:
    """在线迁移检查列是否存在，避免开发库已手工补列时报错。"""

    if context.is_offline_mode() or not _table_exists(table_name):
        return False
    columns = inspect(op.get_bind()).get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def _index_exists(table_name: str, index_name: str) -> bool:
    """在线迁移检查索引是否存在。"""

    if context.is_offline_mode() or not _table_exists(table_name):
        return False
    indexes = inspect(op.get_bind()).get_indexes(table_name)
    return any(index["name"] == index_name for index in indexes)


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if not _column_exists(table_name, column.name):
        op.add_column(table_name, column)


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _index_exists(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    """新增运行追溯、token 拆分、成本、错误分类和 latency 聚合字段。"""

    _add_column_once("model_runs", sa.Column("book_run_id", sa.Integer(), nullable=True))
    _add_column_once("model_runs", sa.Column("chapter_id", sa.Integer(), nullable=True))
    _add_column_once("model_runs", sa.Column("input_tokens", sa.Integer(), server_default="0", nullable=False))
    _add_column_once("model_runs", sa.Column("output_tokens", sa.Integer(), server_default="0", nullable=False))
    _add_column_once("model_runs", sa.Column("cost_estimate", sa.Float(), server_default="0", nullable=False))
    _add_column_once("model_runs", sa.Column("finish_reason", sa.String(length=80), nullable=True))
    _add_column_once("model_runs", sa.Column("error_kind", sa.String(length=80), nullable=True))
    _add_column_once("model_runs", sa.Column("retry_count", sa.Integer(), server_default="0", nullable=False))
    _add_column_once("model_runs", sa.Column("repair_count", sa.Integer(), server_default="0", nullable=False))
    _add_column_once("model_runs", sa.Column("prompt_template_version", sa.String(length=120), nullable=True))
    _add_column_once("model_runs", sa.Column("prompt_hash", sa.String(length=128), nullable=True))
    _create_index_once("ix_model_runs_book_run_id", "model_runs", ["book_run_id"])
    _create_index_once("ix_model_runs_chapter_id", "model_runs", ["chapter_id"])
    _create_index_once("ix_model_runs_error_kind", "model_runs", ["error_kind"])
    _create_index_once("ix_model_runs_prompt_hash", "model_runs", ["prompt_hash"])

    _add_column_once("book_runs", sa.Column("total_latency_ms", sa.Integer(), server_default="0", nullable=False))
    _add_column_once("book_runs", sa.Column("max_latency_ms", sa.Integer(), server_default="0", nullable=False))
    _add_column_once("book_runs", sa.Column("avg_latency_ms", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    """移除本次新增的可观测性字段。"""

    op.drop_column("book_runs", "avg_latency_ms")
    op.drop_column("book_runs", "max_latency_ms")
    op.drop_column("book_runs", "total_latency_ms")
    op.drop_index("ix_model_runs_prompt_hash", table_name="model_runs")
    op.drop_index("ix_model_runs_error_kind", table_name="model_runs")
    op.drop_index("ix_model_runs_chapter_id", table_name="model_runs")
    op.drop_index("ix_model_runs_book_run_id", table_name="model_runs")
    op.drop_column("model_runs", "prompt_hash")
    op.drop_column("model_runs", "prompt_template_version")
    op.drop_column("model_runs", "repair_count")
    op.drop_column("model_runs", "retry_count")
    op.drop_column("model_runs", "error_kind")
    op.drop_column("model_runs", "finish_reason")
    op.drop_column("model_runs", "cost_estimate")
    op.drop_column("model_runs", "output_tokens")
    op.drop_column("model_runs", "input_tokens")
    op.drop_column("model_runs", "chapter_id")
    op.drop_column("model_runs", "book_run_id")
