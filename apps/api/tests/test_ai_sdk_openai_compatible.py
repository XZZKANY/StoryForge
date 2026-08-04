from __future__ import annotations

import time

import pytest

from app.common import llm_client
from app.common.llm_client import LLMError
from app.platform.ai_sdk import ChatMessage, ChatRequest, MessageRole, StreamEventKind, ToolSpec
from app.platform.ai_sdk.providers import OpenAICompatibleProvider


def test_complete_normalizes_content_tools_usage_and_finish_reason() -> None:
    captured: list[dict[str, object]] = []

    def transport(payload: dict[str, object]) -> tuple[dict[str, object], float]:
        captured.append(payload)
        return (
            {
                "id": "response-1",
                "choices": [
                    {
                        "finish_reason": "tool_calls",
                        "message": {
                            "content": "<think>hidden</think> visible",
                            "tool_calls": [
                                {
                                    "id": "call-1",
                                    "type": "function",
                                    "function": {"name": "fs_read", "arguments": {"path": "a.md"}},
                                }
                            ],
                        },
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13},
            },
            time.monotonic(),
        )

    provider = OpenAICompatibleProvider(
        complete_transport=transport,
        content_filter=lambda value: value.replace("<think>hidden</think>", "").strip(),
    )
    response = provider.complete(
        ChatRequest(
            model="test-model",
            messages=(ChatMessage(MessageRole.USER, "read"),),
            tools=(ToolSpec("fs_read", "Read", {"type": "object"}),),
            temperature=0.2,
            max_tokens=100,
            tool_choice="auto",
        )
    )
    assert captured[0]["model"] == "test-model"
    assert captured[0]["temperature"] == 0.2
    assert captured[0]["max_completion_tokens"] == 100
    assert response.content == "visible"
    assert response.tool_calls[0].name == "fs_read"
    assert response.tool_calls[0].arguments_json == '{"path": "a.md"}'
    assert response.usage.total_tokens == 13
    assert response.finish_reason == "tool_calls"
    assert response.response_id == "response-1"
    assert response.metadata["reasoning_leak_stripped"] is True


def test_stream_normalizes_legacy_transport_frames() -> None:
    def stream_transport(payload: dict[str, object]):
        assert payload["stream"] is True
        yield {"type": "delta", "text": "one"}
        yield {
            "type": "done",
            "content": "one",
            "token_usage": 3,
            "prompt_tokens": 2,
            "completion_tokens": 1,
            "cache_hit_tokens": None,
            "token_usage_source": "provider_usage",
            "latency_ms": 5,
        }

    provider = OpenAICompatibleProvider(
        complete_transport=lambda payload: ({}, time.monotonic()),
        stream_transport=stream_transport,
    )
    request = ChatRequest(model="test", messages=(ChatMessage(MessageRole.USER, "go"),))
    events = list(provider.stream(request))
    assert [event.kind for event in events] == [StreamEventKind.TEXT_DELTA, StreamEventKind.COMPLETED]
    assert events[0].text == "one"
    assert events[1].response is not None
    assert events[1].response.content == "one"
    assert events[1].usage is not None
    assert events[1].usage.total_tokens == 3
    assert events[1].metadata["latency_ms"] == 5


def test_capabilities_report_stream_transport_presence() -> None:
    provider = OpenAICompatibleProvider(
        complete_transport=lambda payload: ({}, time.monotonic()),
    )
    assert provider.capabilities("test").streaming is False
    assert provider.health().status.value == "unchecked"


def test_legacy_facade_preserves_malformed_response_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm_client,
        "_request_chat_completions",
        lambda source, payload: ({}, time.monotonic()),
    )
    source = {
        "STORYFORGE_LLM_MODEL": "test",
        "STORYFORGE_LLM_BASE_URL": "https://example.invalid/v1",
        "STORYFORGE_LLM_API_KEY": "sk-test-secret-value",
    }
    with pytest.raises(LLMError, match="缺少 choices"):
        llm_client.call_llm(source, system_prompt="s", user_prompt="u")


def test_legacy_facade_preserves_reasoning_only_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        llm_client,
        "_request_chat_completions",
        lambda source, payload: (
            {"choices": [{"message": {"content": "<think>hidden</think>"}}]},
            time.monotonic(),
        ),
    )
    source = {
        "STORYFORGE_LLM_MODEL": "test",
        "STORYFORGE_LLM_BASE_URL": "https://example.invalid/v1",
        "STORYFORGE_LLM_API_KEY": "sk-test-secret-value",
    }
    with pytest.raises(LLMError, match="仅含思维链"):
        llm_client.call_llm(source, system_prompt="s", user_prompt="u")
