from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_runtime_sqlite_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """每个 workflow 测试使用独立 SQLite，避免共享运行态文件污染。"""

    monkeypatch.setenv("STORYFORGE_WORKFLOW_SQLITE_PATH", str(tmp_path / "workflow-runtime.sqlite3"))
