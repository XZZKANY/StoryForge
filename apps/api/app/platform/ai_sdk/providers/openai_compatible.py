from __future__ import annotations

import time
from collections.abc import Callable, Iterable, Iterator, Mapping
from typing import Any

from app.platform.ai_sdk.capabilities import ProviderCapabilities, resolve_capabilities
from app.platform.ai_sdk.contracts import (
    ChatRequest,
    ChatResponse,
    StreamEvent,
    StreamEventKind,
    TokenUsage,
    ToolCall,
)
from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails
from app.platform.ai_sdk.provider import ProviderHealth, ProviderHealthStatus

RawCompleteTransport = Callable[[dict[str, object]], tuple[dict[str, object], float]]
RawStreamTransport = Callable[[dict[str, object]], Iterable[Mapping[str, object]]]
UsageParser = Callable[[object, str, str], Mapping[str, Any]]
ContentFilter = Callable[[str], str]


def _default_usage(data: object, prompt: str, content: str) -> Mapping[str, Any]:
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, Mapping):
        input_tokens = usage.get("prompt_tokens")
        output_tokens = usage.get("completion_tokens")
        total_tokens = usage.get("total_tokens")
        if isinstance(input_tokens, int) and isinstance(output_tokens, int):
            return {
                "prompt_tokens": max(0, input_tokens),
                "completion_tokens": max(0, output_tokens),
                "token_usage": max(
                    0,
                    total_tokens if isinstance(total_tokens, int) else input_tokens + output_tokens,
                ),
                "cache_hit_tokens": None,
                "token_usage_source": "provider_usage",
            }
    input_tokens = max(1, len(prompt) // 4)
    output_tokens = max(1, len(content) // 4)
    return {
        "prompt_tokens": input_tokens,
        "completion_tokens": output_tokens,
        "token_usage": input_tokens + output_tokens,
        "cache_hit_tokens": None,
        "token_usage_source": "estimated_split",
    }


class OpenAICompatibleProvider:
    """Typed adapter over an OpenAI-compatible wire transport."""

    def __init__(
        self,
        *,
        complete_transport: RawCompleteTransport,
        stream_transport: RawStreamTransport | None = None,
        content_filter: ContentFilter | None = None,
        usage_parser: UsageParser | None = None,
        configured_capabilities: Mapping[str, ProviderCapabilities] | None = None,
        verified_capabilities: Mapping[str, ProviderCapabilities] | None = None,
    ) -> None:
        self._complete_transport = complete_transport
        self._stream_transport = stream_transport
        self._content_filter = content_filter or (lambda content: content.strip())
        self._usage_parser = usage_parser or _default_usage
        self._configured_capabilities = configured_capabilities
        self._verified_capabilities = verified_capabilities

    def complete(self, request: ChatRequest) -> ChatResponse:
        payload = self.build_payload(request)
        data, started_at = self._complete_transport(payload)
        message = self.assistant_message(data)
        raw_content = message.get("content")
        content_before_filter = raw_content.strip() if isinstance(raw_content, str) else ""
        content = self._content_filter(content_before_filter) if content_before_filter else ""
        tool_calls = self.tool_calls(message)
        prompt = "\n".join(str(message.content or "") for message in request.messages)
        usage = TokenUsage.from_legacy(self._usage_parser(data, prompt, content))
        choices = data.get("choices")
        first_choice = choices[0] if isinstance(choices, list) and choices else None
        finish_reason = (
            str(first_choice.get("finish_reason"))
            if isinstance(first_choice, Mapping) and first_choice.get("finish_reason") is not None
            else None
        )
        metadata: dict[str, Any] = {
            "latency_ms": max(0, int((time.monotonic() - started_at) * 1000)),
        }
        if content != content_before_filter:
            metadata["reasoning_leak_stripped"] = True
        return ChatResponse(
            content=content,
            tool_calls=tool_calls,
            usage=usage,
            finish_reason=finish_reason,
            response_id=str(data.get("id")) if data.get("id") is not None else None,
            metadata=metadata,
        )

    def stream(self, request: ChatRequest) -> Iterator[StreamEvent]:
        if self._stream_transport is None:
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.UNSUPPORTED,
                    "OpenAI-compatible provider does not have a streaming transport.",
                )
            )
        completed_calls: list[ToolCall] = []
        for frame in self._stream_transport(self.build_payload(request, stream=True)):
            frame_type = frame.get("type")
            if frame_type == "delta":
                text = frame.get("text")
                if isinstance(text, str) and text:
                    yield StreamEvent(StreamEventKind.TEXT_DELTA, text=text)
                continue
            if frame_type in {"tool_call_delta", "tool_call_completed"}:
                raw_call = frame.get("tool_call")
                call = ToolCall.from_openai(raw_call) if isinstance(raw_call, Mapping) else None
                if call is not None:
                    kind = (
                        StreamEventKind.TOOL_CALL_DELTA
                        if frame_type == "tool_call_delta"
                        else StreamEventKind.TOOL_CALL_COMPLETED
                    )
                    if kind is StreamEventKind.TOOL_CALL_COMPLETED:
                        completed_calls.append(call)
                    yield StreamEvent(kind, tool_call=call)
                continue
            if frame_type == "usage":
                yield StreamEvent(StreamEventKind.USAGE, usage=TokenUsage.from_legacy(frame))
                continue
            if frame_type == "error":
                category_value = str(frame.get("category") or ProviderErrorCategory.RESPONSE.value)
                try:
                    category = ProviderErrorCategory(category_value)
                except ValueError:
                    category = ProviderErrorCategory.RESPONSE
                raise ProviderError(
                    ProviderErrorDetails(
                        category,
                        "OpenAI-compatible streaming request failed.",
                        retryable=bool(frame.get("retryable")),
                        provider_code=str(frame.get("code")) if frame.get("code") is not None else None,
                    )
                )
            if frame_type != "done":
                continue
            content = str(frame.get("content") or "")
            usage = TokenUsage.from_legacy(frame)
            raw_calls = frame.get("tool_calls")
            if isinstance(raw_calls, list):
                completed_calls = [
                    call
                    for raw_call in raw_calls
                    if isinstance(raw_call, Mapping)
                    and (call := ToolCall.from_openai(raw_call)) is not None
                ]
            metadata = {
                key: value
                for key, value in frame.items()
                if key
                not in {
                    "type",
                    "content",
                    "token_usage",
                    "prompt_tokens",
                    "completion_tokens",
                    "cache_hit_tokens",
                    "token_usage_source",
                    "tool_calls",
                    "finish_reason",
                    "response_id",
                }
            }
            finish_reason = (
                str(frame.get("finish_reason")) if frame.get("finish_reason") is not None else None
            )
            response = ChatResponse(
                content=content,
                tool_calls=tuple(completed_calls),
                usage=usage,
                finish_reason=finish_reason,
                response_id=(
                    str(frame.get("response_id")) if frame.get("response_id") is not None else None
                ),
                metadata=metadata,
            )
            yield StreamEvent(
                StreamEventKind.COMPLETED,
                response=response,
                usage=usage,
                finish_reason=finish_reason,
                metadata=metadata,
            )

    def health(self) -> ProviderHealth:
        return ProviderHealth(ProviderHealthStatus.UNCHECKED)

    def capabilities(self, model: str) -> ProviderCapabilities:
        return resolve_capabilities(
            model,
            configured=self._configured_capabilities,
            verified=self._verified_capabilities,
            fallback=ProviderCapabilities(
                streaming=self._stream_transport is not None,
                native_tools=None,
                parallel_tool_calls=None,
                tool_choice=None,
                reasoning=None,
                usage=None,
                reason="OpenAI-compatible endpoints vary; configure or verify model capabilities.",
            ),
        )

    @staticmethod
    def build_payload(request: ChatRequest, *, stream: bool = False) -> dict[str, object]:
        payload: dict[str, object] = {
            "model": request.model,
            "messages": [message.to_openai() for message in request.messages],
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None and request.max_tokens > 0:
            payload["max_completion_tokens"] = request.max_tokens
        if request.reasoning_effort:
            payload["reasoning_effort"] = request.reasoning_effort
        if request.tools:
            payload["tools"] = [tool.to_openai() for tool in request.tools]
            if request.tool_choice is not None:
                payload["tool_choice"] = request.tool_choice
        if stream:
            payload["stream"] = True
            payload["stream_options"] = {"include_usage": True}
        return payload

    @staticmethod
    def assistant_message(data: Mapping[str, object]) -> Mapping[str, object]:
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.RESPONSE,
                    "Provider response is missing choices.",
                    provider_code="missing_choices",
                )
            )
        first_choice = choices[0]
        if not isinstance(first_choice, Mapping):
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.RESPONSE,
                    "Provider choice has an invalid shape.",
                    provider_code="invalid_choice",
                )
            )
        message = first_choice.get("message")
        if not isinstance(message, Mapping):
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.RESPONSE,
                    "Provider response is missing message.",
                    provider_code="missing_message",
                )
            )
        return message

    @staticmethod
    def tool_calls(message: Mapping[str, object]) -> tuple[ToolCall, ...]:
        raw_calls = message.get("tool_calls")
        if not isinstance(raw_calls, list):
            return ()
        return tuple(
            call
            for raw_call in raw_calls
            if isinstance(raw_call, Mapping) and (call := ToolCall.from_openai(raw_call)) is not None
        )
