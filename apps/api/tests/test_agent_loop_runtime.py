from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.domains.agent_runs import loop_runtime
from app.domains.assistant import service as assistant_service
from app.domains.book_runs.errors import BookGenerationError


@pytest.fixture()
def novel_project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "设定").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text("灯塔第三十三次错误闪光。\n", encoding="utf-8")
    (tmp_path / "设定" / "人物.md").write_text("林岚：审计员。\n", encoding="utf-8")
    return tmp_path


def _enable_loop_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})


def _fake_llm_script(monkeypatch: pytest.MonkeyPatch, responses: list[object]) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    def fake_call(source, *, messages, tools=None, tool_choice=None):  # noqa: ANN001
        calls.append({"messages": [dict(item) for item in messages], "tools": tools})
        scripted = responses[min(len(calls) - 1, len(responses) - 1)]
        if isinstance(scripted, Exception):
            raise scripted
        return dict(scripted)  # type: ignore[arg-type]

    monkeypatch.setattr(loop_runtime, "_call_llm_messages", fake_call)
    return calls


def _send_chat_message(client: TestClient, *, run_id: str, project_path: str, message: str) -> list[dict]:
    with client.websocket_connect(f"/api/ide/agent/sessions/session-{run_id}") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "stream": True,
                "run_id": run_id,
                "user_message": message,
                "args": {
                    "project_path": project_path,
                    "context_bundle": {"files": []},
                },
            }
        )
        received = [websocket.receive_json()]
        while received[-1]["type"] not in ("agent_result", "error"):
            received.append(websocket.receive_json())
    return received


def test_chat_loop_executes_fs_tools_and_answers(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """自由文本对话走工具循环：LLM 自主 fs.list/fs.read 后作答，事件与证据链齐全。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "fs_list", "arguments": "{}"}},
                    {
                        "id": "c2",
                        "type": "function",
                        "function": {"name": "fs_read", "arguments": json.dumps({"path": "正文/第01章.md"})},
                    },
                ],
                "completion_tokens": 5,
            },
            {"content": "第一章写灯塔连续异常闪光，林岚开始留证。", "tool_calls": [], "completion_tokens": 9},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop",
        project_path=str(novel_project),
        message="这个项目现在写到哪一步了？",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["intent"] == "chat.explain"
    assert result["agent_result"]["summary"] == "第一章写灯塔连续异常闪光，林岚开始留证。"
    assert result["agent_result"]["chat_loop"]["rounds"] == 2
    assert result["agent_result"]["chat_loop"]["tool_call_count"] == 2
    assert [trace["tool_name"] for trace in result["tool_trace"]] == ["fs.list", "fs.read"]

    # 第二轮 LLM 请求里必须带回工具结果（fs.read 的正文内容进了 tool 消息）
    assert len(calls) == 2
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert len(tool_messages) == 2
    assert any("灯塔" in str(item.get("content")) for item in tool_messages)

    # REST 事件流：真实 plan + 两条 tool_trace
    events = client.get("/api/agent-runs/run-chat-loop/events").json()
    event_types = [event["event_type"] for event in events]
    assert "agent_plan_created" in event_types
    trace_events = [event for event in events if event["event_type"] == "tool_trace"]
    assert [event["payload"]["trace"]["tool_name"] for event in trace_events] == ["fs.list", "fs.read"]

    # 会话消息与工具调用证据链
    assistant_session_id = result["assistant_session_id"]
    session_detail = client.get(f"/api/assistant/sessions/{assistant_session_id}").json()
    assert [message["role"] for message in session_detail["messages"]][-2:] == ["user", "assistant"]
    tool_calls = client.get(f"/api/assistant/sessions/{assistant_session_id}/tool-calls").json()
    tool_names = [item["tool_name"] for item in tool_calls]
    assert "fs.list" in tool_names
    assert "fs.read" in tool_names
    assert "assistant.chat_loop" in tool_names


def test_chat_loop_feeds_unknown_tool_error_back_and_recovers(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """LLM 请求未知工具时不崩：错误作为观测反馈，模型下一轮仍可作答。"""

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "fs_delete", "arguments": "{}"}}
                ],
                "completion_tokens": 3,
            },
            {"content": "我只有只读权限，先说结论。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-unknown",
        project_path=str(novel_project),
        message="随便聊聊这个项目",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "我只有只读权限，先说结论。"
    assert [trace["status"] for trace in result["tool_trace"]] == ["failed"]

    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert len(tool_messages) == 1
    assert "未知工具" in str(tool_messages[0]["content"])


def test_chat_loop_falls_back_to_single_turn_when_first_call_fails(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """首轮 LLM 调用失败（如 provider 不支持 tools）时静默回落单轮对话。"""

    _enable_loop_env(monkeypatch)
    _fake_llm_script(monkeypatch, [BookGenerationError("真实 LLM 返回 HTTP 400：tools 不支持")])
    monkeypatch.setattr(
        assistant_service,
        "chat_reply",
        lambda session, *, user_message, context_block, assistant_session_id: {
            "reply": "单轮回答",
            "model": "fake-model",
            "completion_tokens": 1,
            "latency_ms": 1,
        },
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-fallback",
        project_path=str(novel_project),
        message="讲讲这个项目",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "单轮回答"
    assert "chat_loop" not in result["agent_result"]
    assert result["tool_trace"] == []

    events = client.get("/api/agent-runs/run-chat-loop-fallback/events").json()
    assert [event["event_type"] for event in events].count("agent_plan_created") == 1


def test_chat_loop_skipped_without_project_path(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """没有 project_path 时不进工具循环，保持原单轮对话路径。"""

    _enable_loop_env(monkeypatch)

    def _should_not_be_called(source, *, messages, tools=None, tool_choice=None):  # noqa: ANN001
        raise AssertionError("无 project_path 不应进入工具循环")

    monkeypatch.setattr(loop_runtime, "_call_llm_messages", _should_not_be_called)
    monkeypatch.setattr(
        assistant_service,
        "chat_reply",
        lambda session, *, user_message, context_block, assistant_session_id: {
            "reply": "无项目单轮回答",
            "model": "fake-model",
            "completion_tokens": 1,
            "latency_ms": 1,
        },
    )

    with client.websocket_connect("/api/ide/agent/sessions/session-run-no-project") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "stream": True,
                "run_id": "run-chat-no-project",
                "user_message": "讲讲写作思路",
                "args": {"context_bundle": {"files": []}},
            }
        )
        received = [websocket.receive_json()]
        while received[-1]["type"] not in ("agent_result", "error"):
            received.append(websocket.receive_json())

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "无项目单轮回答"
