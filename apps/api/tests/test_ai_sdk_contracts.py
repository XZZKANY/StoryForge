from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.platform.ai_sdk import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    MessageRole,
    ProviderContinuation,
    StreamEvent,
    StreamEventKind,
    ToolCall,
    ToolSpec,
)
from app.platform.ai_sdk.providers import DeterministicProvider

SDK_ROOT = Path(__file__).parents[1] / "app" / "platform" / "ai_sdk"


def test_sdk_production_imports_do_not_depend_on_application_layers() -> None:
    forbidden = ("app.domains", "fastapi", "sqlalchemy", "apps.desktop", "tauri")
    violations: list[str] = []
    for path in SDK_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            module = node.module if isinstance(node, ast.ImportFrom) else None
            names = [alias.name for alias in node.names] if isinstance(node, ast.Import) else []
            for imported in ([module] if module else names):
                if imported and imported.startswith(forbidden):
                    violations.append(f"{path.relative_to(SDK_ROOT)} imports {imported}")
    assert not violations


def test_openai_message_round_trip_preserves_tool_correlation() -> None:
    payload = {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {"name": "fs_read", "arguments": {"path": "正文/第1章.md"}},
            }
        ],
    }
    message = ChatMessage.from_openai(payload)
    assert message.role is MessageRole.ASSISTANT
    assert message.tool_calls == (
        ToolCall("call-1", "fs_read", '{"path": "正文/第1章.md"}'),
    )
    assert message.to_openai() == {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call-1",
                "type": "function",
                "function": {"name": "fs_read", "arguments": '{"path": "正文/第1章.md"}'},
            }
        ],
    }


def test_contract_collections_are_immutable_snapshots() -> None:
    messages = [ChatMessage(MessageRole.USER, "hello")]
    request = ChatRequest(model="test", messages=tuple(messages), metadata={"source": "test"})
    messages.append(ChatMessage(MessageRole.USER, "later"))
    assert len(request.messages) == 1
    with pytest.raises(TypeError):
        request.metadata["source"] = "changed"  # type: ignore[index]

    continuation = ProviderContinuation("test", {"nested": {"signature": "fixed"}})
    with pytest.raises(TypeError):
        continuation.state["nested"]["signature"] = "changed"  # type: ignore[index]


def test_tool_spec_round_trip_does_not_invent_optional_description() -> None:
    payload = {
        "type": "function",
        "function": {"name": "record", "parameters": {"type": "object"}},
    }
    spec = ToolSpec.from_openai(payload)
    assert spec is not None
    assert spec.to_openai() == payload


def test_deterministic_provider_supports_complete_and_stream() -> None:
    response = ChatResponse(content="fixed", finish_reason="stop")
    provider = DeterministicProvider(
        responses=[response],
        streams=[
            [
                StreamEvent(StreamEventKind.TEXT_DELTA, text="fi"),
                StreamEvent(StreamEventKind.TEXT_DELTA, text="xed"),
                StreamEvent(StreamEventKind.COMPLETED, response=response),
            ]
        ],
    )
    request = ChatRequest(model="deterministic", messages=(ChatMessage(MessageRole.USER, "go"),))
    assert provider.complete(request) == response
    assert [event.kind for event in provider.stream(request)] == [
        StreamEventKind.TEXT_DELTA,
        StreamEventKind.TEXT_DELTA,
        StreamEventKind.COMPLETED,
    ]
    assert provider.health().status.value == "healthy"
    assert provider.capabilities("deterministic").native_tools is True
