from __future__ import annotations

from fastapi.testclient import TestClient


def create_session(client: TestClient) -> int:
    response = client.post(
        "/api/assistant/sessions",
        json={
            "title": "工具调用追溯",
            "task_type": "trial_generation",
            "book_run_id": 12,
            "messages": [{"role": "user", "content": "暂停 BookRun"}],
        },
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def test_assistant_tool_call_create_update_and_list(client: TestClient) -> None:
    """Assistant tool call 事实源支持创建、更新和按会话重放。"""

    assistant_session_id = create_session(client)

    create_response = client.post(
        f"/api/assistant/sessions/{assistant_session_id}/tool-calls",
        json={
            "tool_name": "book_run.pause",
            "status": "running",
            "input_summary": {"book_run_id": 12, "command": "pause"},
            "related_type": "book_run",
            "related_id": 12,
        },
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["session_id"] == assistant_session_id
    assert created["tool_name"] == "book_run.pause"
    assert created["status"] == "running"
    assert created["input_summary"] == {"book_run_id": 12, "command": "pause"}
    assert created["output_summary"] == {}
    assert created["related_type"] == "book_run"
    assert created["related_id"] == 12
    assert created["error_message"] is None

    update_response = client.patch(
        f"/api/assistant/tool-calls/{created['id']}",
        json={
            "status": "completed",
            "output_summary": {"summary": "BookRun #12 已暂停。"},
            "finished_at": "2026-06-09T21:30:00+08:00",
        },
    )
    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()
    assert updated["status"] == "completed"
    assert updated["output_summary"] == {"summary": "BookRun #12 已暂停。"}
    assert updated["finished_at"].startswith("2026-06-09T21:30:00")

    list_response = client.get(f"/api/assistant/sessions/{assistant_session_id}/tool-calls")
    assert list_response.status_code == 200, list_response.text
    tool_calls = list_response.json()
    assert [tool_call["id"] for tool_call in tool_calls] == [created["id"]]
    assert tool_calls[0]["status"] == "completed"


def test_assistant_tool_call_returns_404_for_missing_session(client: TestClient) -> None:
    """不存在的 Assistant 会话不能创建或列出 tool call。"""

    create_response = client.post(
        "/api/assistant/sessions/999999/tool-calls",
        json={"tool_name": "chapter.review", "status": "planned"},
    )
    assert create_response.status_code == 404, create_response.text
    assert "Assistant 会话不存在" in create_response.json()["detail"]

    list_response = client.get("/api/assistant/sessions/999999/tool-calls")
    assert list_response.status_code == 404, list_response.text
    assert "Assistant 会话不存在" in list_response.json()["detail"]


def test_assistant_tool_call_returns_404_for_missing_tool_call(client: TestClient) -> None:
    """更新不存在的 tool call 时返回明确 404。"""

    response = client.patch("/api/assistant/tool-calls/999999", json={"status": "failed"})

    assert response.status_code == 404, response.text
    assert "Assistant 工具调用不存在" in response.json()["detail"]


def test_assistant_tool_call_rejects_sensitive_payload_keys(client: TestClient) -> None:
    """tool call 接口不得接收额外敏感字段。"""

    assistant_session_id = create_session(client)

    response = client.post(
        f"/api/assistant/sessions/{assistant_session_id}/tool-calls",
        json={
            "tool_name": "artifact.export",
            "status": "completed",
            "api_key": "secret-should-not-enter-db",
        },
    )

    assert response.status_code == 422, response.text
    assert "api_key" in response.text
    assert "secret-should-not-enter-db" not in response.text
