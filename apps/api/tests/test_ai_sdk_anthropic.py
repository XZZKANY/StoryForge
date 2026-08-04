from __future__ import annotations

import json
import time

import pytest

from app.platform.ai_sdk import (
    ChatMessage,
    ChatRequest,
    MessageRole,
    ProviderError,
    StreamEventKind,
    ToolCall,
    ToolSpec,
)
from app.platform.ai_sdk.providers import AnthropicProvider


def _request() -> ChatRequest:
    return ChatRequest(
        model="claude-test",
        messages=(
            ChatMessage(MessageRole.SYSTEM, "system rules"),
            ChatMessage(MessageRole.USER, "read the chapter"),
            ChatMessage(
                MessageRole.ASSISTANT,
                tool_calls=(ToolCall("tool-1", "fs_read", '{"path":"chapter.md"}'),),
            ),
            ChatMessage(MessageRole.TOOL, '{"content":"text"}', tool_call_id="tool-1", name="fs_read"),
        ),
        tools=(ToolSpec("fs_read", "Read a file", {"type": "object"}),),
        max_tokens=2048,
        tool_choice="auto",
        reasoning_effort="low",
    )


def test_anthropic_complete_converts_native_messages_tools_usage_and_thinking() -> None:
    captured: list[dict[str, object]] = []

    def transport(payload: dict[str, object]):
        captured.append(payload)
        return (
            {
                "id": "msg-1",
                "content": [
                    {"type": "thinking", "thinking": "private"},
                    {"type": "text", "text": "checking"},
                    {"type": "tool_use", "id": "tool-2", "name": "fs_read", "input": {"path": "next.md"}},
                ],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 20, "output_tokens": 8, "cache_read_input_tokens": 4},
            },
            time.monotonic(),
        )

    response = AnthropicProvider(complete_transport=transport).complete(_request())

    assert captured[0]["system"] == "system rules"
    assert captured[0]["thinking"] == {"type": "enabled", "budget_tokens": 1024}
    assert captured[0]["tools"] == [
        {"name": "fs_read", "description": "Read a file", "input_schema": {"type": "object"}}
    ]
    messages = captured[0]["messages"]
    assert isinstance(messages, list)
    assert messages[-1] == {
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": "tool-1", "content": '{"content":"text"}'}
        ],
    }
    assert response.content == "checking"
    assert response.tool_calls == (ToolCall("tool-2", "fs_read", '{"path": "next.md"}'),)
    assert response.finish_reason == "tool_calls"
    assert response.usage.total_tokens == 28
    assert response.usage.cached_input_tokens == 4
    assert response.usage.reasoning_tokens is None
    assert "private" not in json.dumps(dict(response.metadata))
    assert AnthropicProvider(complete_transport=transport).capabilities("unknown").reasoning is None


def test_anthropic_stream_aggregates_tool_arguments_and_usage() -> None:
    def stream_transport(payload: dict[str, object]):
        assert payload["stream"] is True
        yield {"type": "message_start", "message": {"id": "msg-2", "usage": {"input_tokens": 5}}}
        yield {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}
        yield {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "done"}}
        yield {
            "type": "content_block_start",
            "index": 1,
            "content_block": {"type": "tool_use", "id": "tool-9", "name": "fs_read", "input": {}},
        }
        yield {
            "type": "content_block_delta",
            "index": 1,
            "delta": {"type": "input_json_delta", "partial_json": '{"path":'},
        }
        yield {
            "type": "content_block_delta",
            "index": 1,
            "delta": {"type": "input_json_delta", "partial_json": '"a.md"}'},
        }
        yield {"type": "content_block_stop", "index": 1}
        yield {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 4}}
        yield {"type": "message_stop"}

    provider = AnthropicProvider(
        complete_transport=lambda payload: ({}, time.monotonic()),
        stream_transport=stream_transport,
    )
    events = list(provider.stream(_request()))
    completed_call = next(event.tool_call for event in events if event.kind is StreamEventKind.TOOL_CALL_COMPLETED)
    final = events[-1]

    assert completed_call == ToolCall("tool-9", "fs_read", '{"path":"a.md"}')
    assert final.kind is StreamEventKind.COMPLETED
    assert final.response is not None
    assert final.response.content == "done"
    assert final.response.tool_calls == (completed_call,)
    assert final.response.usage.input_tokens == 5
    assert final.response.usage.output_tokens == 4
    assert final.response.finish_reason == "tool_calls"


def test_anthropic_native_auth_error_is_safe_and_non_retryable() -> None:
    secret = "sk-ant-secret-value"
    provider = AnthropicProvider(
        complete_transport=lambda payload: (
            {
                "type": "error",
                "error": {"type": "authentication_error", "message": f"bad {secret}"},
            },
            time.monotonic(),
        )
    )
    with pytest.raises(ProviderError) as caught:
        provider.complete(_request())
    assert caught.value.details.category.value == "authentication"
    assert caught.value.details.retryable is False
    assert secret not in str(caught.value)


def test_anthropic_rejects_invalid_thinking_budget_before_transport() -> None:
    calls = 0

    def transport(payload: dict[str, object]):
        nonlocal calls
        calls += 1
        return ({}, time.monotonic())

    request = ChatRequest(
        model="claude-test",
        messages=(ChatMessage(MessageRole.USER, "think"),),
        max_tokens=512,
        reasoning_effort="low",
    )
    with pytest.raises(ProviderError) as caught:
        AnthropicProvider(complete_transport=transport).complete(request)
    assert caught.value.details.category.value == "invalid_request"
    assert caught.value.details.retryable is False
    assert calls == 0


def test_anthropic_thinking_signature_round_trips_without_runtime_branching() -> None:
    thinking_block = {"type": "thinking", "thinking": "private", "signature": "signed-state"}
    provider = AnthropicProvider(
        complete_transport=lambda payload: (
            {
                "content": [
                    thinking_block,
                    {"type": "tool_use", "id": "tool-2", "name": "fs_read", "input": {}},
                ],
                "stop_reason": "tool_use",
                "usage": {},
            },
            time.monotonic(),
        )
    )
    response = provider.complete(
        ChatRequest(
            model="claude-test",
            messages=(ChatMessage(MessageRole.USER, "read"),),
            max_tokens=2048,
            reasoning_effort="low",
        )
    )
    follow_up = ChatRequest(
        model="claude-test",
        messages=(
            response.to_assistant_message(),
            ChatMessage(MessageRole.TOOL, "{}", tool_call_id="tool-2", name="fs_read"),
        ),
    )
    payload = provider.build_payload(follow_up)
    messages = payload["messages"]
    assert isinstance(messages, list)
    assert messages[0]["content"][0] == thinking_block
