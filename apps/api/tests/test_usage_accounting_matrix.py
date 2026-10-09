from __future__ import annotations

from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _fake_llm_script
from agent_transport import agent_result
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import (
    AssistantDraftRequest,
    AssistantReviseRequest,
    AssistantSessionCreate,
)

CORE_USAGE_FIELDS = {
    "prompt_tokens",
    "completion_tokens",
    "token_usage",
    "cost_cny_estimated",
    "cost_breakdown",
    "token_usage_source",
}


def _usage_result(content: str) -> dict[str, object]:
    return {
        "content": content,
        "tool_calls": [],
        "prompt_tokens": 11,
        "completion_tokens": 7,
        "token_usage": 18,
        "token_usage_source": "provider_usage",
        "cost_cny_estimated": 0.003,
        "cost_breakdown": {
            "currency": "CNY",
            "prompt_tokens": 11,
            "completion_tokens": 7,
            "input_cny": 0.001,
            "output_cny": 0.002,
            "total_cny": 0.003,
            "source": "provider_usage",
        },
        "latency_ms": 5,
    }


def _record_agent_loop_usage(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    project_path: Path,
) -> dict[str, object]:
    _fake_llm_script(monkeypatch, [_usage_result("完成")])
    response = agent_result(
        client,
        "session-usage-matrix",
        run_id="run-usage-matrix",
        user_message="检查 usage",
        args={
            "project_path": str(project_path),
            "context_bundle": {"files": []},
        },
    )
    assert response["type"] == "agent_result", response

    tool_calls = client.get(
        f"/api/assistant/sessions/{response['assistant_session_id']}/tool-calls"
    ).json()
    return next(item["output_summary"] for item in tool_calls if item["tool_name"] == "assistant.chat_loop")


def _record_assistant_usage(session: Session) -> dict[str, dict[str, object]]:
    chat_session = assistant_service.create_assistant_session(
        session,
        AssistantSessionCreate(title="usage chat", task_type="desktop_chat"),
    )
    assistant_service.chat_reply(
        session,
        user_message="检查 usage",
        context_block="",
        assistant_session_id=chat_session.id,
    )
    revise = assistant_service.revise_file_content(
        session,
        AssistantReviseRequest(file_path="正文.md", content="原文", instruction="修订"),
    )
    draft = assistant_service.draft_file_content(
        session,
        AssistantDraftRequest(file_path="新章.md", instruction="起草"),
    )
    return {
        "assistant.chat": assistant_service.list_assistant_tool_calls(session, chat_session.id)[
            0
        ].output_summary,
        "assistant.revise": assistant_service.list_assistant_tool_calls(
            session, revise.assistant_session_id
        )[0].output_summary,
        "assistant.draft": assistant_service.list_assistant_tool_calls(
            session, draft.assistant_session_id
        )[0].output_summary,
    }


def test_chat_usage_fields_are_consistent_across_all_sinks(
    session: Session,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(
        assistant_service,
        "resolved_llm_env",
        lambda: {"STORYFORGE_LLM_MODEL": "usage-test-model"},
    )
    # 两个传输符号一起打桩：产字三条路径走流式聚合，chat_reply 仍走非流式。
    for _seam in ("_call_llm", "_call_llm_streamed"):
        monkeypatch.setattr(
            assistant_service,
            _seam,
            lambda *args, **kwargs: _usage_result("单轮结果"),
        )
    project_path = tmp_path / "novel"
    project_path.mkdir()

    sinks = {
        "agent.chat_loop": _record_agent_loop_usage(client, monkeypatch, project_path),
        **_record_assistant_usage(session),
    }
    missing = {name: CORE_USAGE_FIELDS - summary.keys() for name, summary in sinks.items()}

    assert not any(missing.values()), missing
