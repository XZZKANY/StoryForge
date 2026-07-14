from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import (
    _enable_loop_env,
    _fake_llm_script,
    _send_chat_message,
)
from agent_transport import stream_agent_message
from fastapi.testclient import TestClient

from app.domains.agent_runs import loop_runtime
from app.domains.agent_runs.models import AgentRun
from app.domains.assistant import service as assistant_service

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


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

    received = stream_agent_message(
        client,
        "session-run-no-project",
        run_id="run-chat-no-project",
        user_message="讲讲写作思路",
        args={"context_bundle": {"files": []}},
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert result["agent_result"]["summary"] == "无项目单轮回答"


def test_chat_loop_stops_between_rounds_and_wraps_up_without_completing(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """作者在循环中途点停止：下一轮开头读到 stopped 即收尾落库，不再烧新一轮，
    run 停在 stopped、无 complete 事件、第二轮工具不再执行（F09）。"""

    from app.domains.agent_runs import runtime as agent_runtime
    from app.domains.agent_runs.service import record_agent_control_event

    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "fs_list", "arguments": "{}"}},
                ],
                "completion_tokens": 5,
            },
            # 第二轮理论上会再发工具调用；但循环应在 before_round:2 就停下，这条不应被消费。
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c2",
                        "type": "function",
                        "function": {"name": "fs_read", "arguments": json.dumps({"path": "正文/第01章.md"})},
                    },
                ],
                "completion_tokens": 5,
            },
            {"content": "不该走到这条最终回答。", "tool_calls": [], "completion_tokens": 3},
        ],
    )

    original_runtime_interruption = agent_runtime.AgentRuntime._runtime_interruption  # noqa: SLF001
    stopped_once = {"value": False}

    def stop_before_second_round(self, run: AgentRun, *, boundary: str):  # noqa: ANN001, ANN202
        if boundary == "before_round:2" and not stopped_once["value"]:
            stopped_once["value"] = True
            record_agent_control_event(
                self._event_sink._session,  # noqa: SLF001
                public_id=run.public_id,
                session_id=run.session_id,
                control_type="stop_run",
                payload={"reason": "test stop between loop rounds"},
            )
        return original_runtime_interruption(self, run, boundary=boundary)

    monkeypatch.setattr(agent_runtime.AgentRuntime, "_runtime_interruption", stop_before_second_round)

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-stop",
        project_path=str(novel_project),
        message="这个项目现在写到哪一步了？",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert stopped_once["value"] is True
    assert result["runtime_interruption"]["status"] == "stopped"

    # 只发了第一轮 LLM 请求（before_round:2 已停，第二轮请求未发出）。
    assert len(calls) == 1

    # 事件表：第一轮的 fs.list trace 有，第二轮 fs.read trace 不该出现，且无 completed 事件。
    events = client.get("/api/agent-runs/run-chat-loop-stop/events").json()
    event_types = [event["event_type"] for event in events]
    assert "agent_run_completed" not in event_types
    trace_names = [
        event["payload"]["trace"]["tool_name"]
        for event in events
        if event["event_type"] == "tool_trace"
    ]
    assert "fs.read" not in trace_names

    run_detail = client.get("/api/agent-runs/run-chat-loop-stop").json()
    assert run_detail["status"] == "stopped"


def test_chat_loop_records_byo_key_cost_in_evidence(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """F32：每轮 chat/completions 的估算成本与 prompt_tokens 累加进 assistant.chat_loop 证据
    output_summary，BYO-key 成本可观测不再名存实亡（此前只留 completion_tokens、丢掉成本）。"""

    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "fs_list", "arguments": "{}"}},
                ],
                "prompt_tokens": 120,
                "completion_tokens": 5,
                "cost_cny_estimated": 0.012,
            },
            {
                "content": "已看过项目结构。",
                "tool_calls": [],
                "prompt_tokens": 200,
                "completion_tokens": 9,
                "cost_cny_estimated": 0.02,
            },
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-cost",
        project_path=str(novel_project),
        message="项目结构是怎样的？",
    )
    result = received[-1]
    assert result["type"] == "agent_result", result

    assistant_session_id = result["assistant_session_id"]
    tool_calls = client.get(f"/api/assistant/sessions/{assistant_session_id}/tool-calls").json()
    chat_loop = next(item for item in tool_calls if item["tool_name"] == "assistant.chat_loop")
    summary = chat_loop["output_summary"]
    # 两轮累加：prompt 120+200、completion 5+9、成本 0.012+0.02
    assert summary["prompt_tokens"] == 320
    assert summary["completion_tokens"] == 14
    assert summary["cost_cny_estimated"] == pytest.approx(0.032)
