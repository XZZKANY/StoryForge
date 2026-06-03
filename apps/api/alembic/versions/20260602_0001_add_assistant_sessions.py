"""新增 Assistant 会话追溯表。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260602_0001"
down_revision: str | None = "20260529_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建 Assistant 会话与消息表，用于追溯用户意图和工具执行摘要。"""

    op.create_table(
        "assistant_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("task_type", sa.String(length=50), nullable=False),
        sa.Column("blueprint_id", sa.Integer(), nullable=True),
        sa.Column("book_run_id", sa.Integer(), nullable=True),
        sa.Column("artifact_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["blueprint_id"], ["book_blueprints.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["book_run_id"], ["book_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["artifact_id"], ["artifacts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_assistant_sessions_task_type"), "assistant_sessions", ["task_type"], unique=False)
    op.create_index(op.f("ix_assistant_sessions_blueprint_id"), "assistant_sessions", ["blueprint_id"], unique=False)
    op.create_index(op.f("ix_assistant_sessions_book_run_id"), "assistant_sessions", ["book_run_id"], unique=False)
    op.create_index(op.f("ix_assistant_sessions_artifact_id"), "assistant_sessions", ["artifact_id"], unique=False)

    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["assistant_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_assistant_messages_session_id"), "assistant_messages", ["session_id"], unique=False)


def downgrade() -> None:
    """移除 Assistant 会话与消息表。"""

    op.drop_index(op.f("ix_assistant_messages_session_id"), table_name="assistant_messages")
    op.drop_table("assistant_messages")
    op.drop_index(op.f("ix_assistant_sessions_artifact_id"), table_name="assistant_sessions")
    op.drop_index(op.f("ix_assistant_sessions_book_run_id"), table_name="assistant_sessions")
    op.drop_index(op.f("ix_assistant_sessions_blueprint_id"), table_name="assistant_sessions")
    op.drop_index(op.f("ix_assistant_sessions_task_type"), table_name="assistant_sessions")
    op.drop_table("assistant_sessions")
