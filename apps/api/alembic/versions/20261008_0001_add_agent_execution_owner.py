"""Add a private row-local witness for AgentRun execution ownership."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "20261008_0001"
down_revision: str | None = "20260703_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_runs"
_COLUMN = "execution_owner_event_id"
_BACKFILL = """
UPDATE agent_runs SET execution_owner_event_id = (
    SELECT id FROM agent_run_events
    WHERE run_id = agent_runs.id
      AND event_type IN ('agent_execution_started', 'agent_execution_claimed')
    ORDER BY sequence DESC, id DESC LIMIT 1
)
WHERE execution_owner_event_id IS NULL
"""


def upgrade() -> None:
    offline = context.is_offline_mode()
    if offline or _COLUMN not in {column["name"] for column in sa.inspect(op.get_bind()).get_columns(_TABLE)}:
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.Integer(), nullable=True))
    op.execute(_BACKFILL)


def downgrade() -> None:
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)
