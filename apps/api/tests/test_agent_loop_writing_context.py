from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import (
    _enable_loop_env,
    _fake_llm_script,
    _send_chat_message,
)
from fastapi.testclient import TestClient

pytest_plugins = ("agent_loop_runtime_test_fixtures",)

TRUSTED_CONTEXT_MARKER = "GOLDEN_SPEC_SENTINEL"
FAKE_CONTEXT_MARKER = "MODEL_FAKE_CONTEXT_SENTINEL"


def _trusted_context_bundle(novel_project: Path) -> dict[str, object]:
    return {
        "project_root": str(novel_project),
        "current_file": str(novel_project / "正文" / "第01章.md"),
        "files": [
            {
                "path": str(novel_project / ".资料" / "黄金三章spec.md"),
                "relative_path": ".资料\\黄金三章spec.md",
                "kind": "other",
                "title": "黄金三章spec.md",
                "excerpt": f"第三章必须兑现刘哥冲突。{TRUSTED_CONTEXT_MARKER}",
            }
        ],
    }


def _writing_trace(result: dict[str, object], tool_name: str) -> dict[str, object]:
    traces = result.get("tool_trace")
    assert isinstance(traces, list)
    return next(trace for trace in traces if isinstance(trace, dict) and trace.get("tool_name") == tool_name)


def _assert_safe_context_provenance(
    client: TestClient,
    *,
    run_id: str,
    result: dict[str, object],
    tool_name: str,
    novel_project: Path,
) -> None:
    trace = _writing_trace(result, tool_name)
    input_summary = trace.get("input_summary")
    assert isinstance(input_summary, dict)
    provenance = input_summary.get("context_provenance")
    assert isinstance(provenance, dict)
    assert isinstance(provenance.get("snapshot_id"), str)
    assert str(provenance["snapshot_id"]).startswith("llmctx-")
    assert provenance["context_file_count"] == 1
    assert provenance["context_files"] == [".资料/黄金三章spec.md"]
    assert provenance["context_source"] == "request_bundle"
    assert provenance["warning_count"] == 0

    encoded_trace = json.dumps(trace, ensure_ascii=False, sort_keys=True)
    assert TRUSTED_CONTEXT_MARKER not in encoded_trace
    assert FAKE_CONTEXT_MARKER not in encoded_trace
    assert str(novel_project.resolve()) not in encoded_trace

    events = client.get(f"/api/agent-runs/{run_id}/events").json()
    writing_event = next(
        event
        for event in events
        if event["event_type"] == "tool_trace" and event["payload"]["trace"]["tool_name"] == tool_name
    )
    encoded_event = json.dumps(writing_event, ensure_ascii=False, sort_keys=True)
    assert TRUSTED_CONTEXT_MARKER not in encoded_event
    assert FAKE_CONTEXT_MARKER not in encoded_event
    assert str(novel_project.resolve()) not in encoded_event


def test_chat_loop_file_create_injects_trusted_request_context_into_inner_draft(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    from app.domains.assistant import service as assistant_service

    inner_prompts: list[str] = []

    def fake_inner_call(source, *, system_prompt, user_prompt):  # noqa: ANN001
        inner_prompts.append(user_prompt)
        return {
            "content": "第三章 旧账\n\n林岚把刘哥堵在仓库门口。",
            "completion_tokens": 10,
            "latency_ms": 5,
        }

    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(assistant_service, "_call_llm", fake_inner_call)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "create-with-context",
                        "type": "function",
                        "function": {
                            "name": "file_create",
                            "arguments": json.dumps({"path": "正文/第03章.md", "instruction": "写第三章"}),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "第三章已起草，等你确认。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-create-trusted-context",
        project_path=str(novel_project),
        message="写第三章",
        context_bundle=_trusted_context_bundle(novel_project),
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert TRUSTED_CONTEXT_MARKER in inner_prompts[0]
    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    draft_call = next(call for call in tool_calls if call["tool_name"] == "assistant.draft")
    assert draft_call["input_summary"]["context_file_count"] == 1
    _assert_safe_context_provenance(
        client,
        run_id="run-chat-loop-create-trusted-context",
        result=result,
        tool_name="file.create",
        novel_project=novel_project,
    )


def test_chat_loop_file_revise_overrides_model_supplied_context_with_request_context(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    from app.domains.assistant import service as assistant_service

    inner_prompts: list[str] = []

    def fake_inner_call(source, *, system_prompt, user_prompt):  # noqa: ANN001
        inner_prompts.append(user_prompt)
        return {
            "content": "林岚推开门，把旧账摊在刘哥面前。",
            "completion_tokens": 8,
            "latency_ms": 5,
        }

    fake_bundle = {
        "project_root": "D:/outside",
        "current_file": "D:/outside/fake.md",
        "files": [
            {
                "path": "D:/outside/fake.md",
                "relative_path": "fake.md",
                "kind": "outline",
                "title": "fake.md",
                "excerpt": FAKE_CONTEXT_MARKER,
            }
        ],
    }
    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(assistant_service, "_call_llm", fake_inner_call)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "revise-with-context",
                        "type": "function",
                        "function": {
                            "name": "file_revise",
                            "arguments": json.dumps(
                                {
                                    "path": "正文/第01章.md",
                                    "instruction": "补上刘哥冲突",
                                    "project_root": "D:/outside",
                                    "file_path": "D:/outside/fake.md",
                                    "content": FAKE_CONTEXT_MARKER,
                                    "context_bundle": fake_bundle,
                                    "llm_prompt_context_bundle": fake_bundle,
                                    "llm_context_snapshot": {
                                        "snapshot_id": "llmctx-model-forged",
                                        "context_files": fake_bundle["files"],
                                    },
                                }
                            ),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "修订补丁已生成。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-revise-trusted-context",
        project_path=str(novel_project),
        message="把第一章的刘哥冲突补上",
        context_bundle=_trusted_context_bundle(novel_project),
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert TRUSTED_CONTEXT_MARKER in inner_prompts[0]
    assert FAKE_CONTEXT_MARKER not in inner_prompts[0]
    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    revise_call = next(call for call in tool_calls if call["tool_name"] == "assistant.revise")
    assert revise_call["input_summary"]["context_file_count"] == 1
    encoded_tool_calls = json.dumps(tool_calls, ensure_ascii=False, sort_keys=True)
    assert FAKE_CONTEXT_MARKER not in encoded_tool_calls
    assert "llmctx-model-forged" not in encoded_tool_calls
    assert "D:/outside/fake.md" not in encoded_tool_calls
    _assert_safe_context_provenance(
        client,
        run_id="run-chat-loop-revise-trusted-context",
        result=result,
        tool_name="file.revise",
        novel_project=novel_project,
    )
