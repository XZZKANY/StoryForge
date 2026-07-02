from __future__ import annotations

from fastapi.testclient import TestClient


def test_assistant_session_create_append_and_recent(client: TestClient) -> None:
    """Assistant 会话薄层只保存消息和任务引用，供首页最近记录追溯。"""

    create_response = client.post(
        "/api/assistant/sessions",
        json={
            "title": "三章试读任务",
            "task_type": "trial_generation",
            "blueprint_id": 10,
            "book_run_id": 20,
            "messages": [{"role": "user", "content": "写三章悬疑试读"}],
        },
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["title"] == "三章试读任务"
    assert created["task_type"] == "trial_generation"
    assert created["blueprint_id"] == 10
    assert created["book_run_id"] == 20
    assert created["messages"][0]["content"] == "写三章悬疑试读"

    append_response = client.post(
        f"/api/assistant/sessions/{created['id']}/messages",
        json={"role": "assistant", "content": "已创建真实 BookRun。"},
    )
    assert append_response.status_code == 201, append_response.text
    appended = append_response.json()
    assert appended["role"] == "assistant"
    assert appended["content"] == "已创建真实 BookRun。"

    recent_response = client.get("/api/assistant/sessions")
    assert recent_response.status_code == 200, recent_response.text
    recent = recent_response.json()
    assert recent[0]["id"] == created["id"]
    assert len(recent[0]["messages"]) == 2

    detail_response = client.get(f"/api/assistant/sessions/{created['id']}")
    assert detail_response.status_code == 200, detail_response.text
    detail = detail_response.json()
    assert detail["id"] == created["id"]
    assert detail["title"] == "三章试读任务"
    assert [message["content"] for message in detail["messages"]] == [
        "写三章悬疑试读",
        "已创建真实 BookRun。",
    ]


def test_assistant_session_list_filters_by_project_path(client: TestClient) -> None:
    """桌面端会话历史按 project_path 过滤，只返回当前项目的会话。"""

    for title, project_path in (
        ("项目A会话", "D:/novels/project-a"),
        ("项目B会话", "D:/novels/project-b"),
        ("无项目会话", None),
    ):
        response = client.post(
            "/api/assistant/sessions",
            json={
                "title": title,
                "task_type": "ide_agent_orchestration",
                "project_path": project_path,
                "messages": [],
            },
        )
        assert response.status_code == 201, response.text

    filtered = client.get("/api/assistant/sessions", params={"project_path": "D:/novels/project-a"})
    assert filtered.status_code == 200, filtered.text
    sessions = filtered.json()
    assert [item["title"] for item in sessions] == ["项目A会话"]
    assert sessions[0]["project_path"] == "D:/novels/project-a"

    unfiltered = client.get("/api/assistant/sessions")
    assert unfiltered.status_code == 200
    assert len(unfiltered.json()) >= 3


def test_assistant_session_detail_returns_404_for_missing_session(client: TestClient) -> None:
    """读取不存在的 Assistant 会话详情时应返回明确 404。"""

    response = client.get("/api/assistant/sessions/999999")

    assert response.status_code == 404, response.text
    assert "Assistant 会话不存在" in response.json()["detail"]


def test_assistant_session_rejects_sensitive_payload_keys(client: TestClient) -> None:
    """会话接口不得接收 API Key 等敏感字段，避免凭据进入普通业务表。"""

    response = client.post(
        "/api/assistant/sessions",
        json={
            "title": "错误凭据测试",
            "task_type": "trial_generation",
            "api_key": "secret-should-not-enter-db",
            "messages": [{"role": "user", "content": "写一章"}],
        },
    )
    assert response.status_code == 422, response.text
    assert "api_key" in response.text
