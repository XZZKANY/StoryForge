from __future__ import annotations

import time

import pytest

from app.platform.ai_sdk import (
    ChatMessage,
    ChatRequest,
    MessageRole,
    ProviderError,
    ProviderErrorCategory,
    StreamEventKind,
    ToolCall,
    ToolSpec,
)
from app.platform.ai_sdk.providers import GeminiProvider


def _request() -> ChatRequest:
    return ChatRequest(
        model="gemini-test",
        messages=(
            ChatMessage(MessageRole.SYSTEM, "system rules"),
            ChatMessage(MessageRole.USER, "read"),
            ChatMessage(
                MessageRole.ASSISTANT,
                tool_calls=(ToolCall("call-1", "fs_read", '{"path":"chapter.md"}'),),
            ),
            ChatMessage(MessageRole.TOOL, '{"content":"text"}', tool_call_id="call-1", name="fs_read"),
        ),
        tools=(ToolSpec("fs_read", "Read a file", {"type": "object"}),),
        max_tokens=512,
        tool_choice={"type": "function", "function": {"name": "fs_read"}},
        reasoning_effort="medium",
    )


def test_gemini_complete_converts_parts_function_calls_usage_and_thinking() -> None:
    captured: list[tuple[str, dict[str, object]]] = []

    def transport(model: str, payload: dict[str, object]):
        captured.append((model, payload))
        return (
            {
                "responseId": "response-1",
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "role": "model",
                            "parts": [
                                {"thought": True, "text": "private"},
                                {"text": "done"},
                                {"functionCall": {"id": "call-2", "name": "fs_read", "args": {"path": "next.md"}}},
                            ],
                        },
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 9,
                    "candidatesTokenCount": 4,
                    "totalTokenCount": 13,
                    "cachedContentTokenCount": 2,
                    "thoughtsTokenCount": 1,
                },
            },
            time.monotonic(),
        )

    response = GeminiProvider(complete_transport=transport).complete(_request())

    model, payload = captured[0]
    assert model == "gemini-test"
    assert payload["systemInstruction"] == {"parts": [{"text": "system rules"}]}
    assert payload["generationConfig"] == {
        "maxOutputTokens": 512,
        "thinkingConfig": {"thinkingBudget": 4096},
    }
    contents = payload["contents"]
    assert isinstance(contents, list)
    assert contents[-1] == {
        "role": "user",
        "parts": [{"functionResponse": {"name": "fs_read", "response": {"content": "text"}}}],
    }
    assert response.content == "done"
    assert response.tool_calls == (ToolCall("call-2", "fs_read", '{"path": "next.md"}'),)
    assert response.finish_reason == "stop"
    assert response.usage.total_tokens == 13
    assert response.usage.cached_input_tokens == 2
    assert response.usage.reasoning_tokens == 1
    assert "private" not in str(dict(response.metadata))
    assert GeminiProvider(complete_transport=transport).capabilities("unknown").reasoning is None


def test_gemini_stream_normalizes_text_tools_usage_and_finish() -> None:
    def stream_transport(model: str, payload: dict[str, object]):
        assert model == "gemini-test"
        yield {"candidates": [{"content": {"parts": [{"text": "one"}]}}]}
        yield {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"functionCall": {"id": "call-3", "name": "fs_read", "args": {"path": "a.md"}}}
                        ]
                    },
                    "finishReason": "STOP",
                }
            ],
            "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2, "totalTokenCount": 5},
        }

    provider = GeminiProvider(
        complete_transport=lambda model, payload: ({}, time.monotonic()),
        stream_transport=stream_transport,
    )
    events = list(provider.stream(_request()))
    final = events[-1]

    assert [event.kind for event in events].count(StreamEventKind.TOOL_CALL_COMPLETED) == 1
    assert final.kind is StreamEventKind.COMPLETED
    assert final.response is not None
    assert final.response.content == "one"
    assert final.response.tool_calls[0].name == "fs_read"
    assert final.response.usage.total_tokens == 5
    assert final.response.finish_reason == "stop"


def test_gemini_native_invalid_request_error_is_safe_and_non_retryable() -> None:
    secret = "gemini-secret-value"
    provider = GeminiProvider(
        complete_transport=lambda model, payload: (
            {"error": {"code": 400, "status": "INVALID_ARGUMENT", "message": f"bad {secret}"}},
            time.monotonic(),
        )
    )
    with pytest.raises(ProviderError) as caught:
        provider.complete(_request())
    assert caught.value.details.category is ProviderErrorCategory.INVALID_REQUEST
    assert caught.value.details.retryable is False
    assert secret not in str(caught.value)


def test_gemini_thought_signature_round_trips_without_runtime_branching() -> None:
    provider = GeminiProvider(
        complete_transport=lambda model, payload: (
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "functionCall": {"id": "call-2", "name": "fs_read", "args": {}},
                                    "thoughtSignature": "signed-state",
                                }
                            ]
                        }
                    }
                ]
            },
            time.monotonic(),
        )
    )
    response = provider.complete(
        ChatRequest(model="gemini-test", messages=(ChatMessage(MessageRole.USER, "read"),))
    )
    follow_up = ChatRequest(
        model="gemini-test",
        messages=(
            response.to_assistant_message(),
            ChatMessage(MessageRole.TOOL, "{}", tool_call_id="call-2", name="fs_read"),
        ),
    )
    payload = provider.build_payload(follow_up)
    contents = payload["contents"]
    assert isinstance(contents, list)
    assert contents[0]["parts"][0]["thoughtSignature"] == "signed-state"
