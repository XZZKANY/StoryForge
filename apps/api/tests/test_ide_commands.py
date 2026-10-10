from __future__ import annotations

from starlette.testclient import TestClient

import app.models  # noqa: F401
from app.common.redaction import REDACTED
from app.domains.ide.schemas import IdeCommandResult


def test_unknown_ide_command_returns_404(client: TestClient) -> None:
    """命令薄壳必须显式拒绝未知命令，避免前端误判为成功。"""

    response = client.post("/api/ide/commands/not.exists", json={"args": {}})

    assert response.status_code == 404
    assert response.json() == {"detail": "未知 IDE 命令：not.exists"}


def test_ide_command_result_redacts_sensitive_payload_when_serialized() -> None:
    """旧读 DTO 退役后，live 命令 DTO 仍独立承担嵌套载荷脱敏。"""

    result = IdeCommandResult(
        command_id="audit.open",
        status="accepted",
        payload={"api_key": "test-private-key", "nested": {"token": "test-private-token", "note": "safe"}},
    )

    expected = {"api_key": REDACTED, "nested": {"token": REDACTED, "note": "safe"}}
    assert result.model_dump()["payload"] == expected
    assert result.model_dump(mode="json")["payload"] == expected


def test_bookrun_commands_stay_unregistered() -> None:
    """bookrun.* 桌面入口已摘除（2026-08-01 作者拍板退役批量整书）。

    2026-10-09 整条 BookRun 链已物理删除：`_execute_bookrun_command`、book_runs service /
    REST 与 test_book_run_controls.py 均不复存在，此处已无可回滚的实现，
    本用例退化为「这些命令 id 不得再出现」的防回归闸。
    """

    from app.domains.ide.command_registry import _BUILTIN_COMMANDS

    leaked = sorted(cid for cid in _BUILTIN_COMMANDS if cid.startswith("bookrun."))
    assert not leaked, f"bookrun 命令又被注册回来了：{leaked}"
