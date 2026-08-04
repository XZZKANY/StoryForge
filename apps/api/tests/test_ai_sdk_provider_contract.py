from __future__ import annotations

import time
from collections.abc import Callable

import pytest

from app.platform.ai_sdk import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    MessageRole,
    ProviderError,
    ProviderErrorCategory,
    ProviderErrorDetails,
    StreamEvent,
    StreamEventKind,
    TokenUsage,
    ToolCall,
    ToolSpec,
)
from app.platform.ai_sdk.provider import LLMProvider
from app.platform.ai_sdk.providers import (
    AnthropicProvider,
    DeterministicProvider,
    GeminiProvider,
    OpenAICompatibleProvider,
)

REQUEST = ChatRequest(
    model="contract-model",
    messages=(ChatMessage(MessageRole.USER, "use a tool"),),
    tools=(ToolSpec("lookup", "Lookup", {"type": "object"}),),
)
TOOL_CALL = ToolCall("call-1", "lookup", '{"key": "value"}')
RESPONSE = ChatResponse(
    content="done",
    tool_calls=(TOOL_CALL,),
    usage=TokenUsage(4, 3, 7, source="provider_usage"),
    finish_reason="tool_calls",
)


def _openai_provider() -> LLMProvider:
    native_call = TOOL_CALL.to_openai()

    def complete(payload: dict[str, object]):
        return (
            {
                "choices": [
                    {
                        "finish_reason": "tool_calls",
                        "message": {"content": "done", "tool_calls": [native_call]},
                    }
                ],
                "usage": {"prompt_tokens": 4, "completion_tokens": 3, "total_tokens": 7},
            },
            time.monotonic(),
        )

    def stream(payload: dict[str, object]):
        yield {"type": "delta", "text": "done"}
        yield {"type": "tool_call_completed", "tool_call": native_call}
        yield {
            "type": "done",
            "content": "done",
            "token_usage": 7,
            "prompt_tokens": 4,
            "completion_tokens": 3,
            "token_usage_source": "provider_usage",
            "finish_reason": "tool_calls",
        }

    return OpenAICompatibleProvider(complete_transport=complete, stream_transport=stream)


def _anthropic_provider() -> LLMProvider:
    response = {
        "content": [
            {"type": "text", "text": "done"},
            {"type": "tool_use", "id": "call-1", "name": "lookup", "input": {"key": "value"}},
        ],
        "stop_reason": "tool_use",
        "usage": {"input_tokens": 4, "output_tokens": 3},
    }

    def stream(payload: dict[str, object]):
        yield {"type": "message_start", "message": {"usage": {"input_tokens": 4}}}
        yield {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "done"}}
        yield {
            "type": "content_block_start",
            "index": 1,
            "content_block": {"type": "tool_use", "id": "call-1", "name": "lookup", "input": {"key": "value"}},
        }
        yield {"type": "content_block_stop", "index": 1}
        yield {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 3}}
        yield {"type": "message_stop"}

    return AnthropicProvider(
        complete_transport=lambda payload: (response, time.monotonic()),
        stream_transport=stream,
    )


def _gemini_provider() -> LLMProvider:
    response = {
        "candidates": [
            {
                "finishReason": "STOP",
                "content": {
                    "parts": [
                        {"text": "done"},
                        {"functionCall": {"id": "call-1", "name": "lookup", "args": {"key": "value"}}},
                    ]
                },
            }
        ],
        "usageMetadata": {"promptTokenCount": 4, "candidatesTokenCount": 3, "totalTokenCount": 7},
    }

    def stream(model: str, payload: dict[str, object]):
        yield response

    return GeminiProvider(
        complete_transport=lambda model, payload: (response, time.monotonic()),
        stream_transport=stream,
    )


def _deterministic_provider() -> LLMProvider:
    return DeterministicProvider(
        responses=[RESPONSE],
        streams=[
            [
                StreamEvent(StreamEventKind.TEXT_DELTA, text="done"),
                StreamEvent(StreamEventKind.TOOL_CALL_COMPLETED, tool_call=TOOL_CALL),
                StreamEvent(StreamEventKind.USAGE, usage=RESPONSE.usage),
                StreamEvent(StreamEventKind.COMPLETED, response=RESPONSE, usage=RESPONSE.usage),
            ]
        ],
    )


PROVIDERS: list[tuple[str, Callable[[], LLMProvider]]] = [
    ("openai-compatible", _openai_provider),
    ("anthropic", _anthropic_provider),
    ("gemini", _gemini_provider),
    ("deterministic", _deterministic_provider),
]


@pytest.mark.parametrize(("name", "factory"), PROVIDERS, ids=[item[0] for item in PROVIDERS])
def test_provider_complete_contract(name: str, factory: Callable[[], LLMProvider]) -> None:
    del name
    provider = factory()
    response = provider.complete(REQUEST)
    assert response.content == "done"
    assert response.tool_calls == (TOOL_CALL,)
    assert response.usage.total_tokens == 7
    assert response.finish_reason in {"stop", "tool_calls"}
    assert provider.health().status.value in {"healthy", "unchecked"}
    assert provider.capabilities(REQUEST.model).native_tools in {True, None}


@pytest.mark.parametrize(("name", "factory"), PROVIDERS, ids=[item[0] for item in PROVIDERS])
def test_provider_stream_contract(name: str, factory: Callable[[], LLMProvider]) -> None:
    del name
    events = list(factory().stream(REQUEST))
    final = events[-1]
    assert any(event.kind is StreamEventKind.TEXT_DELTA for event in events)
    assert any(event.kind is StreamEventKind.TOOL_CALL_COMPLETED for event in events)
    assert final.kind is StreamEventKind.COMPLETED
    assert final.response is not None
    assert final.response.content == "done"
    assert final.response.tool_calls == (TOOL_CALL,)
    assert final.response.usage.total_tokens == 7


@pytest.mark.parametrize(
    "category",
    [
        ProviderErrorCategory.AUTHENTICATION,
        ProviderErrorCategory.CONTENT_FILTER,
        ProviderErrorCategory.INVALID_REQUEST,
    ],
)
def test_terminal_provider_error_categories_are_never_retryable(category: ProviderErrorCategory) -> None:
    error = ProviderError(ProviderErrorDetails(category, "safe", retryable=True))
    provider = DeterministicProvider(responses=[error])
    with pytest.raises(ProviderError) as caught:
        provider.complete(REQUEST)
    assert caught.value.details.category is category
    assert caught.value.details.retryable is False


def test_stream_failure_after_first_event_is_not_replayed() -> None:
    attempts = 0

    def stream(payload: dict[str, object]):
        nonlocal attempts
        attempts += 1
        yield {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "text_delta", "text": "partial"},
        }
        raise ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.CONNECTION,
                "stream interrupted after output",
                retryable=True,
            )
        )

    provider = AnthropicProvider(
        complete_transport=lambda payload: ({}, time.monotonic()),
        stream_transport=stream,
    )
    iterator = provider.stream(REQUEST)
    assert next(iterator).text == "partial"
    with pytest.raises(ProviderError):
        list(iterator)
    assert attempts == 1
