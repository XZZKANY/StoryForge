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
