"""assistant_sessions 增加 project_path，支持桌面端按项目列会话历史。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import context, op

revision: str = "20260702_0001"
down_revision: str | None = "20260630_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "assistant_sessions"
_COLUMN = "project_path"
_INDEX = "ix_assistant_sessions_project_path"


def _column_exists() -> bool:
    if context.is_offline_mode():
        return False
    columns = inspect(op.get_bind()).get_columns(_TABLE)
    return any(column["name"] == _COLUMN for column in columns)


def _index_exists() -> bool:
    if context.is_offline_mode():
        return False
    indexes = inspect(op.get_bind()).get_indexes(_TABLE)
    return any(index["name"] == _INDEX for index in indexes)


def upgrade() -> None:
    if not _column_exists():
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.String(length=1024), nullable=True))
    if not _index_exists():
        op.create_index(_INDEX, _TABLE, [_COLUMN])


def downgrade() -> None:
    if _index_exists():
        op.drop_index(_INDEX, table_name=_TABLE)
    if _column_exists():
        op.drop_column(_TABLE, _COLUMN)
