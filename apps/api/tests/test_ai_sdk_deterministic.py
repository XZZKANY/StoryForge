from __future__ import annotations

import pytest

from app.platform.ai_sdk import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    MessageRole,
    ProviderError,
    ProviderErrorCategory,
    ProviderErrorDetails,
    StreamEventKind,
    TokenUsage,
    ToolCall,
)
from app.platform.ai_sdk.providers import DeterministicProvider

REQUEST = ChatRequest(model="deterministic", messages=(ChatMessage(MessageRole.USER, "go"),))


def test_deterministic_provider_replays_tool_and_usage_events_from_response() -> None:
    response = ChatResponse(
        content="working",
        tool_calls=(ToolCall("call-1", "fs_read", "{}"),),
        usage=TokenUsage(2, 3, 5, source="scripted"),
        finish_reason="tool_calls",
    )
    events = list(DeterministicProvider(responses=[response]).stream(REQUEST))
    assert [event.kind for event in events] == [
        StreamEventKind.TEXT_DELTA,
        StreamEventKind.TOOL_CALL_COMPLETED,
        StreamEventKind.USAGE,
        StreamEventKind.COMPLETED,
    ]
    assert events[1].tool_call == response.tool_calls[0]
    assert events[-1].response == response


def test_deterministic_provider_supports_fault_injection() -> None:
    fault = ProviderError(
        ProviderErrorDetails(ProviderErrorCategory.RATE_LIMIT, "scripted rate limit", retryable=True)
    )
    provider = DeterministicProvider(responses=[fault], streams=[fault])
    with pytest.raises(ProviderError) as complete_error:
        provider.complete(REQUEST)
    with pytest.raises(ProviderError) as stream_error:
        list(provider.stream(REQUEST))
    assert complete_error.value.details.retryable is True
    assert stream_error.value.details.category is ProviderErrorCategory.RATE_LIMIT


def test_deterministic_provider_fails_explicitly_when_script_is_exhausted() -> None:
    provider = DeterministicProvider()
    with pytest.raises(ProviderError) as error:
        provider.complete(REQUEST)
    assert error.value.details.category is ProviderErrorCategory.CONFIGURATION
