"""agent_run_events 补 (run_id, sequence) 唯一索引，堵并发写事件的重复序号。"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import inspect

from alembic import context, op

revision: str = "20260703_0001"
down_revision: str | None = "20260702_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_run_events"
_INDEX = "uq_agent_run_events_run_sequence"

# 历史并发竞态可能残留重复 (run_id, sequence)：只对受影响 run 按 (sequence, id)
# 重排为连续序号——与 list_agent_run_events 的排序语义一致——再建唯一索引。
_RENUMBER_DUPLICATES_SQL = f"""
UPDATE {_TABLE} SET sequence = (
    SELECT COUNT(*) FROM {_TABLE} AS prior
    WHERE prior.run_id = {_TABLE}.run_id
      AND (prior.sequence < {_TABLE}.sequence
           OR (prior.sequence = {_TABLE}.sequence AND prior.id <= {_TABLE}.id))
)
WHERE run_id IN (
    SELECT run_id FROM {_TABLE} GROUP BY run_id, sequence HAVING COUNT(*) > 1
)
"""


def _index_exists() -> bool:
    if context.is_offline_mode():
        return False
    indexes = inspect(op.get_bind()).get_indexes(_TABLE)
    return any(index["name"] == _INDEX for index in indexes)


def upgrade() -> None:
    if _index_exists():
        return
    op.execute(_RENUMBER_DUPLICATES_SQL)
    op.create_index(_INDEX, _TABLE, ["run_id", "sequence"], unique=True)


def downgrade() -> None:
    if _index_exists():
        op.drop_index(_INDEX, table_name=_TABLE)
