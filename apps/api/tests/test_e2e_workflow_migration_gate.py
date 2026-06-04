from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
E2E_WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "e2e.yml"


def test_e2e_workflow_runs_alembic_preflight_before_online_migration() -> None:
    """远端 E2E 必须先跑 Alembic 预检，再执行在线数据库迁移。"""

    workflow = E2E_WORKFLOW_PATH.read_text(encoding="utf-8")

    preflight_step = "- name: 执行 Alembic 迁移预检"
    migration_step = "- name: 执行数据库迁移"
    assert preflight_step in workflow
    assert "working-directory: apps/api" in workflow
    assert "run: uv run pytest tests/test_alembic_heads.py -q" in workflow
    assert workflow.index(preflight_step) < workflow.index(migration_step)
