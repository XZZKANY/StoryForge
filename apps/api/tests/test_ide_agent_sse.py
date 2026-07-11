"""本地 SSE 直播端点 + 控制 POST 端点（替代 WS 通道，供桌面端单通道消费）。

帧形状与 WS 完全一致（复用 event_encoders / _agent_user_message_payloads），
故这里只钉住新增的 HTTP 传输接缝：SSE 帧编码、控制回执与错误帧语义。
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.domains.ide import review_reasoning


def _sse_frames(text: str) -> list[dict]:
    frames: list[dict] = []
    for block in text.split("\n\n"):
        data_lines = [
            line[len("data:") :].lstrip(" ")
            for line in block.splitlines()
            if line.startswith("data:")
        ]
        if data_lines:
            frames.append(json.loads("\n".join(data_lines)))
    return frames


def _review_stream_body(run_id: str) -> dict:
    return {
        "run_id": run_id,
        "user_message": "审查当前章节的结构、人物和节奏",
        "intent": "file.review",
        "args": {
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。其实这说明旧案还没结束。众人沉默地离开。",
            "context_bundle": {"files": []},
        },
    }


def test_agent_sse_stream_emits_started_events_and_result(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"]
    )
    response = client.post(
        "/api/ide/agent/sessions/session-sse-review/stream",
        json=_review_stream_body("run-sse-review"),
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = _sse_frames(response.text)
    types = [frame["type"] for frame in frames]
    assert types[0] == "agent_run_started"
    assert frames[0]["run_id"] == "run-sse-review"
    assert "agent_result" in types
    assert any(frame["type"] == "tool_trace" for frame in frames)
    result = frames[-1]
    assert result["type"] == "agent_result"
    assert result["run_id"] == "run-sse-review"
    assert result["intent"] == "file.review"


def test_agent_control_post_rejects_unknown_type(client: TestClient) -> None:
    response = client.post(
        "/api/ide/agent/sessions/session-x/control",
        json={"type": "not-a-control", "run_id": "run-x"},
    )

    assert response.status_code == 200
    assert response.json()["type"] == "error"


def test_agent_control_post_requires_run_id(client: TestClient) -> None:
    response = client.post(
        "/api/ide/agent/sessions/session-x/control",
        json={"type": "pause_run", "run_id": "   "},
    )

    assert response.status_code == 200
    assert response.json()["type"] == "error"


def test_agent_control_post_pauses_run_and_returns_ack(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"]
    )
    stream = client.post(
        "/api/ide/agent/sessions/session-sse-control/stream",
        json=_review_stream_body("run-sse-control"),
    )
    assert stream.status_code == 200

    control = client.post(
        "/api/ide/agent/sessions/session-sse-control/control",
        json={"type": "pause_run", "run_id": "run-sse-control", "payload": {"source": "test"}},
    )

    assert control.status_code == 200
    ack = control.json()
    assert ack["type"] == "pause_run"
    assert ack["status"] == "recorded"
    assert ack["run_id"] == "run-sse-control"
