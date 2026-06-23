"""新增 AgentRun 控制平面事实源表。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260623_0001"
down_revision: str | None = "20260610_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建 AgentRun、事件、子代理和 artifact 表。"""

    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=160), nullable=False),
        sa.Column("assistant_session_id", sa.Integer(), nullable=True),
        sa.Column("book_run_id", sa.Integer(), nullable=True),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("scope", sa.JSON(), nullable=False),
        sa.Column("permission_profile", sa.String(length=40), nullable=False),
        sa.Column("budget", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("root_plan", sa.JSON(), nullable=False),
        sa.Column("current_step", sa.String(length=160), nullable=True),
        sa.ForeignKeyConstraint(["assistant_session_id"], ["assistant_sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["book_run_id"], ["book_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index(op.f("ix_agent_runs_public_id"), "agent_runs", ["public_id"], unique=True)
    op.create_index(op.f("ix_agent_runs_session_id"), "agent_runs", ["session_id"], unique=False)
    op.create_index(op.f("ix_agent_runs_assistant_session_id"), "agent_runs", ["assistant_session_id"], unique=False)
    op.create_index(op.f("ix_agent_runs_book_run_id"), "agent_runs", ["book_run_id"], unique=False)
    op.create_index(op.f("ix_agent_runs_status"), "agent_runs", ["status"], unique=False)

    op.create_table(
        "agent_run_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("actor", sa.String(length=80), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_run_events_run_id"), "agent_run_events", ["run_id"], unique=False)
    op.create_index(op.f("ix_agent_run_events_event_type"), "agent_run_events", ["event_type"], unique=False)

    op.create_table(
        "subagent_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("parent_run_id", sa.Integer(), nullable=True),
        sa.Column("role", sa.String(length=80), nullable=False),
        sa.Column("input", sa.JSON(), nullable=False),
        sa.Column("output", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["parent_run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_subagent_runs_run_id"), "subagent_runs", ["run_id"], unique=False)
    op.create_index(op.f("ix_subagent_runs_parent_run_id"), "subagent_runs", ["parent_run_id"], unique=False)
    op.create_index(op.f("ix_subagent_runs_role"), "subagent_runs", ["role"], unique=False)
    op.create_index(op.f("ix_subagent_runs_status"), "subagent_runs", ["status"], unique=False)

    op.create_table(
        "agent_artifacts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=80), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("requires_confirmation", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_artifacts_run_id"), "agent_artifacts", ["run_id"], unique=False)
    op.create_index(op.f("ix_agent_artifacts_kind"), "agent_artifacts", ["kind"], unique=False)


def downgrade() -> None:
    """移除 AgentRun 控制平面事实源表。"""

    op.drop_index(op.f("ix_agent_artifacts_kind"), table_name="agent_artifacts")
    op.drop_index(op.f("ix_agent_artifacts_run_id"), table_name="agent_artifacts")
    op.drop_table("agent_artifacts")
    op.drop_index(op.f("ix_subagent_runs_status"), table_name="subagent_runs")
    op.drop_index(op.f("ix_subagent_runs_role"), table_name="subagent_runs")
    op.drop_index(op.f("ix_subagent_runs_parent_run_id"), table_name="subagent_runs")
    op.drop_index(op.f("ix_subagent_runs_run_id"), table_name="subagent_runs")
    op.drop_table("subagent_runs")
    op.drop_index(op.f("ix_agent_run_events_event_type"), table_name="agent_run_events")
    op.drop_index(op.f("ix_agent_run_events_run_id"), table_name="agent_run_events")
    op.drop_table("agent_run_events")
    op.drop_index(op.f("ix_agent_runs_status"), table_name="agent_runs")
    op.drop_index(op.f("ix_agent_runs_book_run_id"), table_name="agent_runs")
    op.drop_index(op.f("ix_agent_runs_assistant_session_id"), table_name="agent_runs")
    op.drop_index(op.f("ix_agent_runs_session_id"), table_name="agent_runs")
    op.drop_index(op.f("ix_agent_runs_public_id"), table_name="agent_runs")
    op.drop_table("agent_runs")
