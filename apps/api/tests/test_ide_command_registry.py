from __future__ import annotations

from starlette.testclient import TestClient


def test_known_ide_command_returns_audit_event(client: TestClient) -> None:
    """已注册写命令必须返回可追溯 audit_event_id。"""

    response = client.post("/api/ide/commands/bookrun.start", json={"args": {"book_run_id": 12}})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["command_id"] == "bookrun.start"
    assert body["status"] == "accepted"
    assert body["audit_event_id"].startswith("ide-command:bookrun.start:")
    assert body["payload"]["args"] == {"book_run_id": 12}
    assert body["payload"]["category"] == "BookRun"


def test_unknown_ide_command_still_returns_404(client: TestClient) -> None:
    """未知命令必须保持 404，避免前端误判为已审计。"""

    response = client.post("/api/ide/commands/not.exists", json={"args": {}})

    assert response.status_code == 404
    assert response.json() == {"detail": "未知 IDE 命令：not.exists"}


def test_agent_websocket_write_command_uses_command_registry(client: TestClient) -> None:
    """Agent 写操作必须经同一命令执行器返回 audit_event_id。"""

    with client.websocket_connect("/api/ide/agent/sessions/session-1") as websocket:
        websocket.send_json(
            {
                "type": "command",
                "command_id": "judge.repair",
                "args": {"issue_id": 7, "scene_id": 8},
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "command_result"
    assert message["session_id"] == "session-1"
    assert message["result"]["command_id"] == "judge.repair"
    assert message["result"]["audit_event_id"].startswith("ide-command:judge.repair:")
    assert message["result"]["payload"]["args"] == {"issue_id": 7, "scene_id": 8}


def test_agent_websocket_unknown_command_reports_error(client: TestClient) -> None:
    """Agent 不能绕过命令目录执行未知写操作。"""

    with client.websocket_connect("/api/ide/agent/sessions/session-2") as websocket:
        websocket.send_json({"type": "command", "command_id": "direct.model.write", "args": {}})
        message = websocket.receive_json()

    assert message == {
        "type": "error",
        "session_id": "session-2",
        "detail": "未知 IDE 命令：direct.model.write",
    }
