from __future__ import annotations

from pathlib import Path

MIGRATION_PATH = Path("alembic/versions/20260602_0001_add_assistant_sessions.py")


def test_assistant_sessions_migration_creates_trace_tables() -> None:
    """Assistant 会话 ORM 新表必须有 Alembic 迁移，避免生产库缺表。"""

    migration = MIGRATION_PATH.read_text(encoding="utf-8")

    expected_fragments = {
        'revision: str = "20260602_0001"',
        'down_revision: str | None = "20260529_0001"',
        '"assistant_sessions"',
        '"assistant_messages"',
        'sa.Column("title", sa.String(length=160), nullable=False)',
        'sa.Column("task_type", sa.String(length=50), nullable=False)',
        'sa.Column("blueprint_id", sa.Integer(), nullable=True)',
        'sa.Column("book_run_id", sa.Integer(), nullable=True)',
        'sa.Column("artifact_id", sa.Integer(), nullable=True)',
        'sa.Column("session_id", sa.Integer(), nullable=False)',
        'sa.Column("role", sa.String(length=20), nullable=False)',
        'sa.Column("content", sa.Text(), nullable=False)',
        'sa.ForeignKeyConstraint(["blueprint_id"], ["book_blueprints.id"], ondelete="SET NULL")',
        'sa.ForeignKeyConstraint(["book_run_id"], ["book_runs.id"], ondelete="SET NULL")',
        'sa.ForeignKeyConstraint(["artifact_id"], ["artifacts.id"], ondelete="SET NULL")',
        'sa.ForeignKeyConstraint(["session_id"], ["assistant_sessions.id"], ondelete="CASCADE")',
        '"ix_assistant_sessions_task_type"',
        '"ix_assistant_messages_session_id"',
    }

    missing_fragments = {fragment for fragment in expected_fragments if fragment not in migration}
    assert missing_fragments == set()


def test_assistant_tool_calls_migration_creates_trace_table() -> None:
    """Assistant tool call 事实源必须有独立迁移，避免工具树只能靠 BookRun 推导。"""

    migration = Path("alembic/versions/20260609_0002_add_assistant_tool_calls.py").read_text(
        encoding="utf-8"
    )

    expected_fragments = {
        'revision: str = "20260609_0002"',
        'down_revision: str | None = "20260609_0001"',
        '"assistant_tool_calls"',
        'sa.Column("session_id", sa.Integer(), nullable=False)',
        'sa.Column("tool_name", sa.String(length=120), nullable=False)',
        'sa.Column("status", sa.String(length=40), nullable=False)',
        'sa.Column("input_summary", sa.JSON(), nullable=False)',
        'sa.Column("output_summary", sa.JSON(), nullable=False)',
        'sa.Column("error_message", sa.Text(), nullable=True)',
        'sa.Column("related_type", sa.String(length=80), nullable=True)',
        'sa.Column("related_id", sa.Integer(), nullable=True)',
        'sa.Column("started_at", sa.DateTime(timezone=True), nullable=True)',
        'sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True)',
        'sa.ForeignKeyConstraint(["session_id"], ["assistant_sessions.id"], ondelete="CASCADE")',
        '"ix_assistant_tool_calls_session_id"',
        '"ix_assistant_tool_calls_tool_name"',
        '"ix_assistant_tool_calls_status"',
    }

    missing_fragments = {fragment for fragment in expected_fragments if fragment not in migration}
    assert missing_fragments == set()
