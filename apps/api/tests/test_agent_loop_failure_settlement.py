from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message
from agent_transport import control_agent, stream_agent_message
from fastapi.testclient import TestClient

from app.domains.assistant import service as assistant_service
from app.platform.ai_sdk import ProviderError, ProviderErrorCategory, ProviderErrorDetails

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def fault(category: ProviderErrorCategory = ProviderErrorCategory.CONNECTION) -> ProviderError:
    return ProviderError(ProviderErrorDetails(category, "模型连接中断。"))


def tool(name: str, arguments: dict, *, finish_reason: str | None = None) -> dict:
    return {
        "content": "",
        "tool_calls": [{"id": "call-1", "type": "function", "function": {
            "name": name, "arguments": json.dumps(arguments),
        }}],
        "prompt_tokens": 20, "completion_tokens": 7, "token_usage": 27,
        "token_usage_source": "provider_usage", "finish_reason": finish_reason,
    }


def execute(client: TestClient, monkeypatch: pytest.MonkeyPatch, project: Path, script: list,
            *, profile: str = "ask") -> tuple[dict, list, list]:
    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, script)
    fallback = []
    def fallback_reply(*args, **kwargs):
        fallback.append(True)
        return {"reply": "不应掩盖失败", "model": "fake", "completion_tokens": 1, "latency_ms": 1}
    monkeypatch.setattr(assistant_service, "chat_reply", fallback_reply)
    frames = _send_chat_message(client, run_id="failure-run", project_path=str(project),
                               message="检查并修改这个项目", permission_profile=profile)
    assert not fallback, "明确的调用失败不能悄悄变成成功的单轮回退"
    result = frames[-1]
    assert result["type"] == "agent_result", result
    events = client.get("/api/agent-runs/failure-run/events").json()
    return result, calls, events


def assert_failed(client: TestClient, result: dict, events: list, *, status: str, code: str) -> None:
    outcome = result["agent_result"]["execution_outcome"]
    assert outcome["status"] == status
    assert outcome["code"] == code
    assert client.get("/api/agent-runs/failure-run").json()["status"] == "failed"
    assert not any(event["event_type"] in {"agent_run_completed", "system_job"} for event in events)
    terminal = next(event for event in events if event["event_type"] == "agent_run_failed")
    assert terminal["payload"]["execution_result"] == result
    evidence = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    aggregate = next(item for item in evidence if item["tool_name"] == "assistant.chat_loop")
    assert aggregate["status"] == "failed"
    assert aggregate["output_summary"]["execution_outcome"] == outcome
    assert next(step for step in result["plan"] if step["step"] == "agent.loop")["status"] == "failed"


@pytest.mark.parametrize("category", [ProviderErrorCategory.CONNECTION, ProviderErrorCategory.AUTHENTICATION])
def test_first_provider_failure_is_not_successful_fallback(client, monkeypatch, novel_project, category):
    result, calls, events = execute(client, monkeypatch, novel_project, [fault(category)])
    assert len(calls) == 1
    assert_failed(client, result, events, status="failed", code=f"provider_{category.value}")


def test_later_failure_keeps_completed_read_and_usage(client, monkeypatch, novel_project):
    result, calls, events = execute(client, monkeypatch, novel_project, [
        tool("fs_read", {"path": "正文/第01章.md"}), fault(),
    ])
    assert len(calls) == 2
    assert_failed(client, result, events, status="partial", code="provider_connection")
    assert any(trace["tool_name"] == "fs.read" and trace["status"] == "completed" for trace in result["tool_trace"])
    evidence = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    aggregate = next(item for item in evidence if item["tool_name"] == "assistant.chat_loop")
    assert aggregate["output_summary"]["token_usage"] == 27


def test_truncated_tool_never_executes_and_is_not_completed(client, monkeypatch, novel_project):
    result, calls, events = execute(client, monkeypatch, novel_project, [
        tool("fs_read", {"path": "正文/第01章.md"}, finish_reason="length"),
    ])
    assert len(calls) == 1
    assert_failed(client, result, events, status="failed", code="model_output_truncated")
    assert not any(trace["tool_name"] == "fs.read" for trace in result["tool_trace"])


@pytest.mark.parametrize("profile", ["ask", "auto", "full"])
@pytest.mark.parametrize("control", ["approve_permission", "deny_permission"])
def test_valid_patch_survives_failure_but_always_needs_confirmation(client, monkeypatch, novel_project, profile, control):
    draft = {"content": "第二章\n\n林岚回到灯塔。", "completion_tokens": 9, "latency_ms": 1}
    monkeypatch.setattr(assistant_service, "_call_llm", lambda *args, **kwargs: draft)
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", lambda *args, **kwargs: draft)
    result, calls, events = execute(client, monkeypatch, novel_project, [
        tool("file_create", {"path": "正文/第02章.md", "instruction": "继续写第二章"}), fault(),
    ], profile=profile)
    assert len(calls) == 2
    assert result["agent_result"]["execution_outcome"]["status"] == "partial"
    assert result["agent_result"]["requires_user_confirmation"] is True
    assert result["proposed_patch"]["requires_confirmation"] is True
    assert not (novel_project / "正文/第02章.md").exists()
    assert client.get("/api/agent-runs/failure-run").json()["status"] == "paused"
    assert not any(event["event_type"] in {"agent_run_completed", "system_job"} for event in events)
    pending = next(event for event in events if event["event_type"] == "permission_required")
    assert pending["payload"]["execution_result"] == result
    artifacts = client.get("/api/agent-runs/failure-run/artifacts").json()
    patch = next(item for item in artifacts if item["kind"] == "proposed_patch")
    assert patch["requires_confirmation"] is True
    assert patch["payload"]["requires_confirmation"] is True

    for _ in range(2):
        control_agent(client, "session-failure-run", control_type=control, run_id="failure-run")
    terminal_events = [event for event in client.get("/api/agent-runs/failure-run/events").json()
                       if event["event_type"] in {"agent_run_completed", "agent_run_failed"}]
    assert len(terminal_events) == 1, "重发控制可留命令审计，但不能追加丢失原始结算的终态"
    assert client.get("/api/agent-runs/failure-run").json()["status"] == "failed"
    resolved = terminal_events[-1]["payload"]["execution_result"]
    assert resolved["agent_result"]["execution_outcome"] == result["agent_result"]["execution_outcome"]
    assert resolved["proposed_patch"] is None, "批准回执不能让重连再次投递旧补丁"
    assert resolved["agent_result"]["requires_user_confirmation"] is False
    assert not (novel_project / "正文/第02章.md").exists(), "后端批准不等于 Desktop 已写回"


def test_completed_review_survives_later_failure_in_live_and_replay(client, monkeypatch, novel_project):
    result, calls, events = execute(client, monkeypatch, novel_project, [
        tool("file_review", {"path": "正文/第01章.md"}), fault(),
    ])
    assert len(calls) == 2
    assert_failed(client, result, events, status="partial", code="provider_connection")
    report = result["agent_result"]["review_report"]
    assert report["kind"] == "review_report"
    artifacts = client.get("/api/agent-runs/failure-run/artifacts").json()
    assert next(item for item in artifacts if item["kind"] == "review_report")["payload"] == report


@pytest.mark.parametrize("finish_reason", ["length", "content_filter"])
def test_incomplete_response_never_enters_next_conversation_request(client, monkeypatch, novel_project, finish_reason):
    response = tool("fs_read", {"path": "正文/第01章.md"}, finish_reason=finish_reason)
    response["content"] = "UNCOMMITTED-PROVIDER-FRAGMENT-92317"
    result, _, _ = execute(client, monkeypatch, novel_project, [response])
    calls = _fake_llm_script(monkeypatch, [{"content": "新的完整回答"}])
    received = stream_agent_message(client, "session-failure-run", run_id="next-run",
        assistant_session_id=result["assistant_session_id"], user_message="继续检查", permission_profile="read",
        args={"project_path": str(novel_project), "context_bundle": {"files": []}})
    assert received[-1]["agent_result"]["summary"] == "新的完整回答"
    assert len(calls) == 1
    history = json.dumps(calls[0]["messages"], ensure_ascii=False)
    assert "UNCOMMITTED-PROVIDER-FRAGMENT-92317" not in history
    assert "本轮未完成" in history
