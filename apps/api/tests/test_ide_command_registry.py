from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker
from starlette.testclient import TestClient

from app.domains.events.models import EventLog
from app.domains.ide import command_registry
from app.domains.ide.command_registry import IdeCommandDefinition


@pytest.fixture
def noop_write_command(monkeypatch: pytest.MonkeyPatch) -> str:
    """注册 test-only 写命令:生产目录已无假成功写命令(W0 删 memory.resolve_conflict),
    持久审计事件与 WS 命令通道的机制护栏改由临时命令承载。"""

    command_id = "test.noop_write"
    monkeypatch.setitem(
        command_registry._BUILTIN_COMMANDS,
        command_id,
        IdeCommandDefinition(id=command_id, title="测试写命令", category="Test"),
    )
    return command_id


def sample_args() -> dict[str, str]:
    """构造不依赖业务夹具的命令参数。"""

    return {
        "target_id": "target_1",
        "resolution": "keep_left",
        "reason": "保留已发布章节事实",
    }


def test_known_ide_command_returns_persistent_audit_event(
    client: TestClient,
    session_factory: sessionmaker[Session],
    noop_write_command: str,
) -> None:
    """已注册写命令必须返回可查询的持久 audit_event_id。"""

    args = sample_args()

    response = client.post(f"/api/ide/commands/{noop_write_command}", json={"args": args})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["command_id"] == noop_write_command
    assert body["status"] == "accepted"
    assert body["audit_event_id"].startswith("ide-command-event:")
    assert body["payload"]["args"] == args
    assert body["payload"]["category"] == "Test"

    event_id = int(body["audit_event_id"].removeprefix("ide-command-event:"))
    with session_factory() as session:
        event = session.get(EventLog, event_id)

    assert event is not None
    assert event.event_type == "ide_command_executed"
    assert event.source == "ide.command_registry"
    assert event.payload["command_id"] == noop_write_command
    assert event.payload["status"] == "accepted"
    assert event.payload["args"] == args
    assert event.payload["result"]["category"] == "Test"


def test_unknown_ide_command_still_returns_404(client: TestClient) -> None:
    """未知命令必须保持 404，避免前端误判为已审计。"""

    response = client.post("/api/ide/commands/not.exists", json={"args": {}})

    assert response.status_code == 404
    assert response.json() == {"detail": "未知 IDE 命令：not.exists"}


def test_removed_fake_success_command_returns_404(client: TestClient) -> None:
    """memory.resolve_conflict 零实现假成功命令已删除(证据链红线),必须 404 而非 accepted。"""

    response = client.post("/api/ide/commands/memory.resolve_conflict", json={"args": {}})

    assert response.status_code == 404
    assert response.json() == {"detail": "未知 IDE 命令：memory.resolve_conflict"}


def test_agent_websocket_write_command_uses_command_registry(
    client: TestClient,
    noop_write_command: str,
) -> None:
    """Agent 写操作必须经同一命令执行器返回 audit_event_id。"""

    args = sample_args()

    with client.websocket_connect("/api/ide/agent/sessions/session-1") as websocket:
        websocket.send_json(
            {
                "type": "command",
                "command_id": noop_write_command,
                "args": args,
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "command_result"
    assert message["session_id"] == "session-1"
    assert message["result"]["command_id"] == noop_write_command
    assert message["result"]["audit_event_id"].startswith("ide-command-event:")
    assert message["result"]["payload"]["args"] == args


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
