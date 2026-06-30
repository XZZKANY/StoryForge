from __future__ import annotations

import json
from pathlib import Path

# CI 已于 2026-06-30 整体移除（删 .github/workflows/ci.yml、e2e.yml）。lint + OpenAPI 漂移
# 两道快门禁改由本地 .githooks/pre-push（pnpm run verify:fast）承担。本测试守护这一门禁真相源：
# 远程 workflow 不得重新冒充默认验证门禁，本地 hook 必须持续覆盖 lint 与漂移。
REPO_ROOT = Path(__file__).resolve().parents[3]
GITHUB_WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
PRE_PUSH_HOOK = REPO_ROOT / ".githooks" / "pre-push"
PACKAGE_JSON = REPO_ROOT / "package.json"


def _root_scripts() -> dict[str, str]:
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    return data.get("scripts", {})


def test_ci_removed_no_remote_workflow_acts_as_validation_gate() -> None:
    """CI 已移除：不得存在 .github/workflows 远程门禁来冒充验证真相源。"""

    # 若未来重新引入远程 workflow，必须显式更新本守卫并重新声明门禁意图，
    # 不允许悄悄让远程 CI 重新成为默认验证门禁。
    assert not GITHUB_WORKFLOWS_DIR.exists(), (
        "检测到 .github/workflows 重新出现；CI 已移除，远程 workflow 不得作为默认验证门禁，"
        "请同步更新本测试以声明新的门禁意图。"
    )


def test_local_pre_push_hook_is_the_lint_and_drift_gate() -> None:
    """本地 pre-push hook 取代 CI，承担 lint + OpenAPI 漂移两道快门禁。"""

    assert PRE_PUSH_HOOK.exists(), "缺少 .githooks/pre-push：CI 移除后它是 lint+漂移门禁的唯一本地替代。"
    hook = PRE_PUSH_HOOK.read_text(encoding="utf-8")
    assert "pnpm run verify:fast" in hook

    scripts = _root_scripts()
    assert scripts.get("hooks:install") == "git config core.hooksPath .githooks"
    verify_fast = scripts.get("verify:fast", "")
    assert "lint" in verify_fast and "check:drift" in verify_fast, (
        "verify:fast 必须同时覆盖 lint 与 OpenAPI 漂移检查。"
    )
    assert scripts.get("check:drift") == "node scripts/check-openapi-drift.mjs"
