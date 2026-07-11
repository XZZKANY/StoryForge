from __future__ import annotations

import pytest
from agent_transport import parse_agent_sse
from fastapi.testclient import TestClient

from app.domains.agent_runs.runtime import AgentRuntime


@pytest.mark.parametrize(
    "path",
    [
        "/api/ide/agent/sessions/auth-stream/stream",
        "/api/ide/agent/sessions/auth-control/control",
    ],
)
@pytest.mark.parametrize("api_key", ["", "wrong-key"])
def test_agent_http_transports_reject_missing_or_wrong_api_key(
    client: TestClient,
    path: str,
    api_key: str,
) -> None:
    response = client.post(path, headers={"X-StoryForge-API-Key": api_key}, json={})

    assert response.status_code == 401


def test_agent_stream_accepts_api_key_and_empty_probe_never_enters_tool_loop(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_live_loop(*_args, **_kwargs):  # noqa: ANN002, ANN003, ANN202 - sentinel
        raise AssertionError("empty SSE smoke probe must fail before the live tool loop")

    monkeypatch.setattr(AgentRuntime, "_run_chat_explain", fail_live_loop)

    response = client.post(
        "/api/ide/agent/sessions/auth-stream/stream",
        json={"run_id": "auth-stream-run", "user_message": ""},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = parse_agent_sse(response.text)
    assert [frame["type"] for frame in frames] == ["agent_run_started", "error"]
    assert all(frame["run_id"] == "auth-stream-run" for frame in frames)


def test_agent_control_accepts_api_key(client: TestClient) -> None:
    response = client.post(
        "/api/ide/agent/sessions/auth-control/control",
        json={"type": "smoke_probe", "run_id": "auth-control-run"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "type": "error",
        "session_id": "auth-control",
        "detail": "不支持的控制消息：smoke_probe。",
    }
