from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.agent_runs import loop_runtime
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import (
    AssistantDraftRequest,
    AssistantReviseRequest,
    AssistantSessionCreate,
)
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.book_generation import _record_model_run
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene

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


def _record_book_run_usage(session: Session) -> dict[str, object]:
    book = Book(title="usage matrix", status="draft")
    session.add(book)
    session.flush()
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="usage matrix",
        tone="克制",
        target_word_count=1000,
        target_chapter_count=1,
        chapter_word_count_min=600,
        chapter_word_count_max=1200,
        status="locked",
    )
    chapter = Chapter(book_id=book.id, ordinal=1, title="第一章", status="planned")
    session.add_all([blueprint, chapter])
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="场景一", status="approved", content="正文")
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="completed",
        current_chapter_index=1,
        total_chapters=1,
        progress={},
        checkpoint=[],
    )
    session.add_all([scene, book_run])
    session.commit()

    generated = {
        **_usage_result("正文"),
        "prompt": "写第一章",
    }
    model_run = _record_model_run(
        session,
        book_run,
        scene,
        {
            "STORYFORGE_LLM_PROVIDER": "openai-compatible",
            "STORYFORGE_LLM_MODEL": "usage-test-model",
        },
        generated,
    )
    return {**model_run.payload, "token_usage": model_run.token_usage}


def _record_agent_loop_usage(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    project_path: Path,
) -> dict[str, object]:
    monkeypatch.setattr(loop_runtime, "_call_llm_messages", lambda *args, **kwargs: _usage_result("完成"))
    with client.websocket_connect("/api/ide/agent/sessions/session-usage-matrix") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "stream": True,
                "run_id": "run-usage-matrix",
                "user_message": "检查 usage",
                "args": {
                    "project_path": str(project_path),
                    "context_bundle": {"files": []},
                },
            }
        )
        response = websocket.receive_json()
        while response["type"] not in ("agent_result", "error"):
            response = websocket.receive_json()
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
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        assistant_service,
        "resolved_llm_env",
        lambda: {"STORYFORGE_LLM_MODEL": "usage-test-model"},
    )
    monkeypatch.setattr(
        assistant_service,
        "_call_llm",
        lambda *args, **kwargs: _usage_result("单轮结果"),
    )
    project_path = tmp_path / "novel"
    project_path.mkdir()

    sinks = {
        "book_run.model_run": _record_book_run_usage(session),
        "agent.chat_loop": _record_agent_loop_usage(client, monkeypatch, project_path),
        **_record_assistant_usage(session),
    }
    missing = {name: CORE_USAGE_FIELDS - summary.keys() for name, summary in sinks.items()}

    assert not any(missing.values()), missing
