from __future__ import annotations

from pathlib import Path

import app.models  # noqa: F401
from app.db.base import Base

MIGRATION_PATH = Path("alembic/versions/20260528_0001_backfill_current_orm_schema.py")


def test_schema_backfill_migration_exists() -> None:
    """正式迁移文件必须存在，避免依赖本地 metadata.create_all 补表。"""

    assert MIGRATION_PATH.exists()


def test_schema_backfill_migration_mentions_current_orm_gaps() -> None:
    """迁移文件应显式覆盖当前 ORM 中历史迁移缺失的关键表和列。"""

    migration = MIGRATION_PATH.read_text(encoding="utf-8")
    expected_fragments = {
        "workspaces",
        "workspace_members",
        "workspace_comments",
        "approval_requests",
        "approval_decisions",
        "workspace_subscriptions",
        "event_logs",
        "provider_configs",
        "prompt_packs",
        "artifacts",
        "evaluation_cases",
        "evaluation_runs",
        "model_runs",
        "series_memory_evidence",
        "workspace_id",
    }

    missing_fragments = {fragment for fragment in expected_fragments if fragment not in migration}
    assert missing_fragments == set()


def test_current_orm_metadata_still_declares_book_generation_required_schema() -> None:
    """测试清单与当前 ORM 元数据保持同源，防止迁移测试脱离模型事实。"""

    expected_tables = {
        "workspaces",
        "workspace_members",
        "workspace_comments",
        "approval_requests",
        "approval_decisions",
        "workspace_subscriptions",
        "event_logs",
        "provider_configs",
        "prompt_packs",
        "artifacts",
        "evaluation_cases",
        "evaluation_runs",
        "model_runs",
        "series",
        "series_memories",
        "series_memory_evidence",
    }

    assert expected_tables.issubset(set(Base.metadata.tables))
    assert "workspace_id" in Base.metadata.tables["books"].columns
