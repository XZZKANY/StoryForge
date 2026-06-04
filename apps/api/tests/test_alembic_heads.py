from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKFILL_MIGRATION_PATH = REPO_ROOT / "alembic" / "versions" / "20260528_0001_backfill_current_orm_schema.py"


def test_alembic_migration_graph_has_single_head() -> None:
    """E2E 迁移门禁必须只有一个 Alembic head，避免 upgrade head 无法解析。"""

    config = Config(str(REPO_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(REPO_ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["20260604_0001"]


def test_alembic_offline_sql_upgrade_reaches_head_without_database() -> None:
    """无数据库环境也必须能生成迁移 SQL，作为远端 E2E 的补偿验证。"""

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head", "--sql"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert result.returncode == 0, result.stderr[-2000:]
    assert "20260604_0001" in result.stdout


def test_backfill_phase2_tables_use_real_table_inspection_online(monkeypatch) -> None:
    """在线迁移必须真实检查 Phase 2 表，避免空库误判表已存在。"""

    spec = importlib.util.spec_from_file_location("backfill_current_orm_schema", BACKFILL_MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    inspected_tables: list[str] = []

    class FakeInspector:
        def has_table(self, table_name: str) -> bool:
            inspected_tables.append(table_name)
            return False

    monkeypatch.setattr(migration.context, "is_offline_mode", lambda: False)
    monkeypatch.setattr(migration.op, "get_bind", lambda: object())
    monkeypatch.setattr(migration, "inspect", lambda _bind: FakeInspector())

    assert migration._table_exists("series_memories") is False
    assert inspected_tables == ["series_memories"]
