from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CI_WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"
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


def test_remote_workflows_are_manual_advisory_not_default_validation() -> None:
    """远程 workflow 只能作为手动提示检查，不能替代本地 AI 验证门禁。"""

    ci_workflow = CI_WORKFLOW_PATH.read_text(encoding="utf-8")
    e2e_workflow = E2E_WORKFLOW_PATH.read_text(encoding="utf-8")

    for workflow in (ci_workflow, e2e_workflow):
        assert "workflow_dispatch:" in workflow
        assert "push:" not in workflow
        assert "pull_request:" not in workflow
        assert "schedule:" not in workflow

    assert "pnpm run verify:local" in ci_workflow
