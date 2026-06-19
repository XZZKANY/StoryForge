from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint

from app.domains.assistant import service as assistant_service
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.ide.orchestrator import SUPPORTED_INTENTS


def _seed_chapter_review_context(session_factory: sessionmaker[Session]) -> dict[str, int | str]:
    content = "林岚举起左臂，旁人看见左臂完好无损。作者直接解释这说明她早已摆脱旧伤，港口风声却仍很低。"
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚在港口追查失真的灯塔信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="draft", content=content)
        session.add(scene)
        session.flush()
        packet = ScenePacket(
            scene_id=scene.id,
            status="assembled",
            packet={
                "必须包含事实": ["左臂受伤"],
                "风格规则": ["克制"],
                "证据链接": [{"source_ref": "asset://character/lin-lan#v1", "rationale": "角色资产要求左臂仍受伤。"}],
            },
            version=1,
        )
        session.add(packet)
        session.commit()
        return {"scene_id": scene.id, "scene_packet_id": packet.id, "content": content}


def test_supported_intents_are_registered() -> None:
    assert {
        "chat.explain",
        "file.revise",
        "chapter.review",
        "chapter.repair",
        "bookrun.start",
    } == SUPPORTED_INTENTS


def test_agent_user_message_file_revise_returns_proposed_patch(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        return {"content": "修订后正文", "completion_tokens": 8, "latency_ms": 10}

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    with client.websocket_connect("/api/ide/agent/sessions/session-file-revise") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "user_message": "把这个文件改得更紧一点",
                "args": {
                    "file_path": "正文/第02章.md",
                    "content": "当前正文",
                    "instruction": "检查人物动机",
                },
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "agent_result"
    assert message["intent"] == "file.revise"
    assert message["agent_result"]["requires_user_confirmation"] is True
    assert message["proposed_patch"]["kind"] == "file_revision"
    assert message["proposed_patch"]["requires_confirmation"] is True
    assert message["tool_trace"][0]["tool_name"] == "assistant.revise"
    assert message["tool_trace"][0]["status"] == "completed"
    assert message["tool_trace"][0]["output_summary"]["latency_ms"] == 10

    session_id = message["assistant_session_id"]
    tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    assert len(tool_calls) == 1
    assert tool_calls[0]["tool_name"] == "assistant.revise"
    assert tool_calls[0]["status"] == "completed"


def test_agent_user_message_reuses_existing_assistant_session(client: TestClient) -> None:
    with client.websocket_connect("/api/ide/agent/sessions/session-multi-turn") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "user_message": "先解释这一段",
                "intent": "chat.explain",
                "args": {"context": "第一轮上下文"},
            }
        )
        first = websocket.receive_json()
        websocket.send_json(
            {
                "type": "user_message",
                "assistant_session_id": first["assistant_session_id"],
                "user_message": "继续，换个角度",
                "intent": "chat.explain",
                "args": {"context": "第二轮上下文"},
            }
        )
        second = websocket.receive_json()

    assert second["type"] == "agent_result"
    assert second["assistant_session_id"] == first["assistant_session_id"]

    session_id = first["assistant_session_id"]
    session_detail = client.get(f"/api/assistant/sessions/{session_id}").json()
    assert [message["role"] for message in session_detail["messages"]] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert session_detail["messages"][0]["content"] == "先解释这一段"
    assert session_detail["messages"][2]["content"] == "继续，换个角度"


def test_agent_user_message_returns_error_for_missing_assistant_session(client: TestClient) -> None:
    with client.websocket_connect("/api/ide/agent/sessions/session-missing-assistant") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "assistant_session_id": 999999,
                "user_message": "继续上一轮",
                "intent": "chat.explain",
                "args": {"context": "正文"},
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "error"
    assert message["session_id"] == "session-missing-assistant"
    assert "Assistant 会话不存在" in message["detail"]


def test_agent_user_message_chapter_review_calls_registry_and_waits_for_confirmation(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    context = _seed_chapter_review_context(session_factory)

    with client.websocket_connect("/api/ide/agent/sessions/session-chapter-review") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "user_message": "审阅第二章，给我修复建议",
                "args": {"scene_packet_id": context["scene_packet_id"]},
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "agent_result"
    assert message["intent"] == "chapter.review"
    assert message["agent_result"]["requires_user_confirmation"] is True
    assert message["proposed_patch"]["kind"] == "repair_patch"
    assert message["proposed_patch"]["repair_patch"]["id"] > 0
    assert message["proposed_patch"]["approval_command"]["command_id"] == "judge.approve"

    tool_names = [item["tool_name"] for item in message["tool_trace"]]
    assert tool_names[:2] == ["judge.run", "judge.repair"]

    session_id = message["assistant_session_id"]
    tool_calls = client.get(f"/api/assistant/sessions/{session_id}/tool-calls").json()
    assert [item["tool_name"] for item in tool_calls][0] == "judge.run"
    assert {item["tool_name"] for item in tool_calls[1:]} == {"judge.repair"}


def test_agent_user_message_bookrun_start_reuses_command_registry(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.domains.provider_gateway import service as provider_service
    from app.domains.provider_gateway.runtime_config import load_runtime_provider_config

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "deterministic")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "storyforge-deterministic-writer")
    monkeypatch.delenv("STORYFORGE_LLM_API_KEY", raising=False)
    load_runtime_provider_config.cache_clear()
    provider_service.cache_delete_pattern("storyforge:provider-resolution:*")

    scope = seed_locked_blueprint(session_factory)

    with client.websocket_connect("/api/ide/agent/sessions/session-bookrun-start") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "user_message": "启动这本书的生成流程",
                "args": {
                    "book_id": scope["book_id"],
                    "blueprint_id": scope["blueprint_id"],
                    "token_budget": 900,
                },
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "agent_result"
    assert message["intent"] == "bookrun.start"
    assert message["agent_result"]["book_run"]["status"] == "running"
    assert message["agent_result"]["requires_user_confirmation"] is False
    assert message["tool_trace"][0]["tool_name"] == "bookrun.start"
    assert message["tool_trace"][0]["audit_event_id"].startswith("ide-command-event:")
