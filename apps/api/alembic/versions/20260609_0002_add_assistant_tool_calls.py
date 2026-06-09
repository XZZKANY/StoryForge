"""新增 Assistant 工具调用事实源表。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260609_0002"
down_revision: str | None = "20260609_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建 Assistant tool call 表，用短摘要记录工具执行事实。"""

    op.create_table(
        "assistant_tool_calls",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("tool_name", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("input_summary", sa.JSON(), nullable=False),
        sa.Column("output_summary", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("related_type", sa.String(length=80), nullable=True),
        sa.Column("related_id", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["assistant_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_assistant_tool_calls_session_id"), "assistant_tool_calls", ["session_id"], unique=False)
    op.create_index(op.f("ix_assistant_tool_calls_tool_name"), "assistant_tool_calls", ["tool_name"], unique=False)
    op.create_index(op.f("ix_assistant_tool_calls_status"), "assistant_tool_calls", ["status"], unique=False)
    op.create_index(op.f("ix_assistant_tool_calls_related_id"), "assistant_tool_calls", ["related_id"], unique=False)


def downgrade() -> None:
    """移除 Assistant tool call 事实源表。"""

    op.drop_index(op.f("ix_assistant_tool_calls_related_id"), table_name="assistant_tool_calls")
    op.drop_index(op.f("ix_assistant_tool_calls_status"), table_name="assistant_tool_calls")
    op.drop_index(op.f("ix_assistant_tool_calls_tool_name"), table_name="assistant_tool_calls")
    op.drop_index(op.f("ix_assistant_tool_calls_session_id"), table_name="assistant_tool_calls")
    op.drop_table("assistant_tool_calls")
