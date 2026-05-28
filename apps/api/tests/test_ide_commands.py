from __future__ import annotations

from starlette.testclient import TestClient


def test_unknown_ide_command_returns_404(client: TestClient) -> None:
    """命令薄壳必须显式拒绝未知命令，避免前端误判为成功。"""

    response = client.post("/api/ide/commands/not.exists", json={"args": {}})

    assert response.status_code == 404
    assert response.json() == {"detail": "未知 IDE 命令：not.exists"}
