"""Drop the two never-populated foreign keys on assistant_sessions.

`blueprint_id` / `artifact_id` 与已删的 `book_run_id` 同一形状：可空、只在 create payload 里
透传、桌面端对 `/api/assistant/sessions` 只有 list 与 get（会话由服务端在对话流程里创建，
从不带这两个字段）。作者装机版库 16 条会话里两列非空计数均为 0，目标表亦为 0 行。

守卫与 20261009_0001 同：offline（--sql）拿不到真连接，create_all 建的新库里这两列本就不存在。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "20261010_0001"
down_revision: str | None = "20261009_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "assistant_sessions"
# (列名, 索引名, 目标表)
_COLUMNS = (
    ("blueprint_id", "ix_assistant_sessions_blueprint_id", "book_blueprints"),
    ("artifact_id", "ix_assistant_sessions_artifact_id", "artifacts"),
)


def _offline() -> bool:
    return context.is_offline_mode()


def _has_column(column: str) -> bool:
    if _offline():
        return True
    return column in {item["name"] for item in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def _has_index(index: str) -> bool:
    if _offline():
        return True
    return index in {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(_TABLE)}


def upgrade() -> None:
    for _, index, _target in _COLUMNS:
        if _has_index(index):
            op.drop_index(index, table_name=_TABLE)
    for column, _, _ in _COLUMNS:
        if _has_column(column):
            with op.batch_alter_table(_TABLE) as batch:
                batch.drop_column(column)


def downgrade() -> None:
    for column, index, target in _COLUMNS:
        with op.batch_alter_table(_TABLE) as batch:
            batch.add_column(sa.Column(column, sa.Integer(), nullable=True))
            batch.create_foreign_key(
                f"fk_{_TABLE}_{column}_{target}", target, [column], ["id"], ondelete="SET NULL"
            )
        op.create_index(index, _TABLE, [column], unique=False)
