"""Transient, typed text observations. Never an ORM event or writeback authority."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import TYPE_CHECKING
from uuid import uuid4

from app.common.llm_control import check_run_interruption
from app.common.redaction import is_sensitive_key
from app.common.stream_text import VisibleTextFilter
from app.domains.agent_runs.ws_messages import AgentTextDeltaFrame, AgentTextStreamStartedFrame
from app.platform.ai_sdk import ChatRequest, ChatResponse, LLMProvider, StreamEventKind
from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails

if TYPE_CHECKING:
    from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext

TextFrame = AgentTextStreamStartedFrame | AgentTextDeltaFrame
TextObserver = Callable[[TextFrame], None]


def complete_with_text_stream(
    provider: LLMProvider, request: ChatRequest, *, context: StoryForgeRuntimeContext,
) -> ChatResponse:
    observer = context.on_text
    if observer is None or provider.capabilities(request.model).streaming is not True:
        return provider.complete(request)
    identity = {"run_id": context.run.public_id, "stream_id": str(uuid4()),
                "round_index": context.completed_model_rounds + 1}
    secrets = [value for key, value in context.source.items() if is_sensitive_key(key)]
    visible = VisibleTextFilter(secrets)
    sequence = 0
    observer(AgentTextStreamStartedFrame(**identity))
    response = None
    usage = None
    received_event = False

    def publish(text: str) -> None:
        nonlocal sequence
        for start in range(0, len(text), 4096):
            check_run_interruption("before_text_delta")
            sequence += 1
            observer(AgentTextDeltaFrame(**identity, chunk_sequence=sequence,
                                        text_delta=text[start:start + 4096]))

    events = iter(provider.stream(request))
    try:
        for event in events:
            received_event = True
            if event.usage is not None:
                usage = event.usage
            check_run_interruption("before_text_stream_event")
            if event.kind is StreamEventKind.TEXT_DELTA:
                publish(visible.feed(event.text or ""))
            elif event.kind is StreamEventKind.COMPLETED:
                response = event.response
        if response is None or response.finish_reason not in {
            None, "stop", "tool_calls", "end_turn", "length", "content_filter",
        }:
            raise ProviderError(ProviderErrorDetails(
                ProviderErrorCategory.RESPONSE, "Model text stream did not complete safely.",
                provider_code="incomplete_text_stream",
            ), usage=usage)
        # The SDK owns truncation/filter settlement and usage; never execute partial calls.
        if response.finish_reason not in {"length", "content_filter"}:
            publish(visible.finish())
        final_filter = VisibleTextFilter(secrets)
        content = (final_filter.feed(response.content) + final_filter.finish()).strip()
        return replace(response, content=content)
    except Exception as exc:
        # Once the provider has produced anything, unsupported is not a safe replay signal.
        if (received_event and isinstance(exc, ProviderError)
                and exc.details.category is ProviderErrorCategory.UNSUPPORTED):
            raise ProviderError(replace(exc.details, category=ProviderErrorCategory.RESPONSE),
                                usage=exc.usage or usage) from exc
        if usage is not None and getattr(exc, "usage", None) is None:
            exc.usage = usage
        raise
    finally:
        close = getattr(events, "close", None)
        if close is not None:
            close()
