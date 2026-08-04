from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterable, Iterator, Mapping
from typing import Any

from app.platform.ai_sdk.capabilities import ProviderCapabilities, resolve_capabilities
from app.platform.ai_sdk.contracts import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    MessageRole,
    ProviderContinuation,
    StreamEvent,
    StreamEventKind,
    TokenUsage,
    ToolCall,
    ToolSpec,
)
from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails
from app.platform.ai_sdk.provider import ProviderHealth, ProviderHealthStatus

RawCompleteTransport = Callable[[dict[str, object]], tuple[dict[str, object], float]]
RawStreamTransport = Callable[[dict[str, object]], Iterable[Mapping[str, object]]]

_THINKING_BUDGETS = {"low": 1024, "medium": 4096, "high": 8192}
_STOP_REASONS = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "tool_use": "tool_calls",
    "max_tokens": "length",
    "refusal": "content_filter",
}


def _non_negative_int(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _arguments_object(call: ToolCall) -> dict[str, Any]:
    try:
        value = json.loads(call.arguments_json or "{}")
    except json.JSONDecodeError as exc:
        raise ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.INVALID_REQUEST,
                f"Tool call {call.name!r} has invalid JSON arguments.",
                provider_code="invalid_tool_arguments",
            )
        ) from exc
    if not isinstance(value, dict):
        raise ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.INVALID_REQUEST,
                f"Tool call {call.name!r} arguments must be a JSON object.",
                provider_code="invalid_tool_arguments",
            )
        )
    return value


def _usage(payload: object, *, prior: TokenUsage | None = None) -> TokenUsage:
    data = payload if isinstance(payload, Mapping) else {}
    input_tokens = _non_negative_int(data.get("input_tokens")) or (prior.input_tokens if prior else 0)
    output_tokens = _non_negative_int(data.get("output_tokens")) or (prior.output_tokens if prior else 0)
    cached = _non_negative_int(data.get("cache_read_input_tokens"))
    return TokenUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        cached_input_tokens=cached or (prior.cached_input_tokens if prior else None),
        source="provider_usage",
    )


def _normalized_stop_reason(value: object) -> str | None:
    if value is None:
        return None
    raw = str(value)
    return _STOP_REASONS.get(raw, raw.lower())


class AnthropicProvider:
    """Anthropic Messages adapter with provider-native blocks contained here."""

    def __init__(
        self,
        *,
        complete_transport: RawCompleteTransport,
        stream_transport: RawStreamTransport | None = None,
        default_max_tokens: int = 4096,
        configured_capabilities: Mapping[str, ProviderCapabilities] | None = None,
        verified_capabilities: Mapping[str, ProviderCapabilities] | None = None,
    ) -> None:
        self._complete_transport = complete_transport
        self._stream_transport = stream_transport
        self._default_max_tokens = default_max_tokens
        self._configured_capabilities = configured_capabilities
        self._verified_capabilities = verified_capabilities

    def complete(self, request: ChatRequest) -> ChatResponse:
        data, started_at = self._complete_transport(self.build_payload(request))
        self._raise_for_error(data)
        blocks = data.get("content")
        if not isinstance(blocks, list):
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.RESPONSE,
                    "Anthropic response is missing content blocks.",
                    provider_code="missing_content",
                )
            )
        content, tool_calls, continuation = self._parse_blocks(blocks)
        stop_reason = _normalized_stop_reason(data.get("stop_reason"))
        if stop_reason == "content_filter":
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.CONTENT_FILTER,
                    "Anthropic blocked the response for safety reasons.",
                    provider_code=str(data.get("stop_reason")),
                )
            )
        metadata: dict[str, object] = {
            "latency_ms": max(0, int((time.monotonic() - started_at) * 1000))
        }
        if continuation is not None:
            metadata["reasoning_present"] = True
        return ChatResponse(
            content=content,
            tool_calls=tool_calls,
            usage=_usage(data.get("usage")),
            finish_reason=stop_reason,
            response_id=str(data.get("id")) if data.get("id") is not None else None,
            metadata=metadata,
            continuation=continuation,
        )

    def stream(self, request: ChatRequest) -> Iterator[StreamEvent]:
        if self._stream_transport is None:
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.UNSUPPORTED,
                    "Anthropic provider does not have a streaming transport.",
                )
            )
        text_parts: list[str] = []
        tool_state: dict[int, dict[str, str]] = {}
        completed_calls: list[ToolCall] = []
        usage = TokenUsage()
        finish_reason: str | None = None
        response_id: str | None = None
        reasoning_present = False
        thinking_state: dict[int, dict[str, object]] = {}
        thinking_blocks: list[dict[str, object]] = []

        for frame in self._stream_transport(self.build_payload(request, stream=True)):
            self._raise_for_error(frame)
            frame_type = frame.get("type")
            if frame_type == "message_start":
                message = frame.get("message")
                if isinstance(message, Mapping):
                    response_id = str(message.get("id")) if message.get("id") is not None else None
                    usage = _usage(message.get("usage"), prior=usage)
                    yield StreamEvent(StreamEventKind.USAGE, usage=usage)
                continue
            if frame_type == "content_block_start":
                index = _non_negative_int(frame.get("index"))
                block = frame.get("content_block")
                if isinstance(block, Mapping) and block.get("type") == "tool_use":
                    initial_input = block.get("input")
                    initial_json = (
                        json.dumps(initial_input, ensure_ascii=False)
                        if isinstance(initial_input, dict) and initial_input
                        else ""
                    )
                    tool_state[index] = {
                        "id": str(block.get("id") or ""),
                        "name": str(block.get("name") or ""),
                        "arguments": initial_json,
                    }
                elif isinstance(block, Mapping) and block.get("type") in {
                    "thinking",
                    "redacted_thinking",
                }:
                    reasoning_present = True
                    thinking_state[index] = dict(block)
                continue
            if frame_type == "content_block_delta":
                index = _non_negative_int(frame.get("index"))
                delta = frame.get("delta")
                if not isinstance(delta, Mapping):
                    continue
                delta_type = delta.get("type")
                if delta_type == "text_delta" and isinstance(delta.get("text"), str):
                    text = str(delta["text"])
                    text_parts.append(text)
                    yield StreamEvent(StreamEventKind.TEXT_DELTA, text=text)
                elif delta_type == "thinking_delta" and isinstance(delta.get("thinking"), str):
                    reasoning_present = True
                    state = thinking_state.setdefault(index, {"type": "thinking", "thinking": ""})
                    state["thinking"] = str(state.get("thinking") or "") + str(delta["thinking"])
                    yield StreamEvent(StreamEventKind.REASONING_DELTA, text=str(delta["thinking"]))
                elif delta_type == "signature_delta" and isinstance(delta.get("signature"), str):
                    state = thinking_state.setdefault(index, {"type": "thinking", "thinking": ""})
                    state["signature"] = str(state.get("signature") or "") + str(delta["signature"])
                elif delta_type == "input_json_delta" and index in tool_state:
                    partial = str(delta.get("partial_json") or "")
                    tool_state[index]["arguments"] += partial
                    state = tool_state[index]
                    yield StreamEvent(
                        StreamEventKind.TOOL_CALL_DELTA,
                        tool_call=ToolCall(state["id"], state["name"], partial),
                    )
                continue
            if frame_type == "content_block_stop":
                index = _non_negative_int(frame.get("index"))
                state = tool_state.pop(index, None)
                if state is not None:
                    call = ToolCall(state["id"], state["name"], state["arguments"] or "{}")
                    completed_calls.append(call)
                    yield StreamEvent(StreamEventKind.TOOL_CALL_COMPLETED, tool_call=call)
                thinking_block = thinking_state.pop(index, None)
                if thinking_block is not None:
                    thinking_blocks.append(thinking_block)
                continue
            if frame_type == "message_delta":
                delta = frame.get("delta")
                if isinstance(delta, Mapping):
                    finish_reason = _normalized_stop_reason(delta.get("stop_reason")) or finish_reason
                usage = _usage(frame.get("usage"), prior=usage)
                yield StreamEvent(StreamEventKind.USAGE, usage=usage)
                continue
            if frame_type != "message_stop":
                continue
            if finish_reason == "content_filter":
                raise ProviderError(
                    ProviderErrorDetails(
                        ProviderErrorCategory.CONTENT_FILTER,
                        "Anthropic blocked the streamed response for safety reasons.",
                        provider_code="refusal",
                    )
                )
            metadata = {"reasoning_present": True} if reasoning_present else {}
            continuation = (
                ProviderContinuation("anthropic", {"thinking_blocks": tuple(thinking_blocks)})
                if thinking_blocks
                else None
            )
            response = ChatResponse(
                content="".join(text_parts),
                tool_calls=tuple(completed_calls),
                usage=usage,
                finish_reason=finish_reason,
                response_id=response_id,
                metadata=metadata,
                continuation=continuation,
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
            static=ProviderCapabilities(
                streaming=self._stream_transport is not None,
                native_tools=True,
                parallel_tool_calls=True,
                tool_choice=True,
                system_messages=True,
                reasoning=None,
                usage=True,
                json_response=False,
                reason="Thinking and model token limits require a model-specific descriptor.",
            ),
        )

    def build_payload(self, request: ChatRequest, *, stream: bool = False) -> dict[str, object]:
        system = "\n\n".join(
            message.content or "" for message in request.messages if message.role is MessageRole.SYSTEM
        ).strip()
        max_tokens = request.max_tokens or self._default_max_tokens
        payload: dict[str, object] = {
            "model": request.model,
            "messages": [
                self._native_message(message)
                for message in request.messages
                if message.role is not MessageRole.SYSTEM
            ],
            "max_tokens": max_tokens,
        }
        if system:
            payload["system"] = system
        if request.reasoning_effort:
            budget = _THINKING_BUDGETS.get(request.reasoning_effort)
            if budget is None:
                raise ProviderError(
                    ProviderErrorDetails(
                        ProviderErrorCategory.INVALID_REQUEST,
                        "Anthropic reasoning effort must be low, medium, or high.",
                        provider_code="invalid_reasoning_effort",
                    )
                )
            if max_tokens <= budget:
                raise ProviderError(
                    ProviderErrorDetails(
                        ProviderErrorCategory.INVALID_REQUEST,
                        "Anthropic max_tokens must be greater than the thinking budget.",
                        provider_code="invalid_thinking_budget",
                    )
                )
            if request.temperature is not None and request.temperature != 1:
                raise ProviderError(
                    ProviderErrorDetails(
                        ProviderErrorCategory.INVALID_REQUEST,
                        "Anthropic thinking requests require temperature 1 or an omitted temperature.",
                        provider_code="invalid_thinking_temperature",
                    )
                )
            payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.tools:
            payload["tools"] = [self._native_tool(tool) for tool in request.tools]
            tool_choice = self._tool_choice(request.tool_choice)
            if tool_choice is not None:
                payload["tool_choice"] = tool_choice
        if stream:
            payload["stream"] = True
        return payload

    @staticmethod
    def _native_message(message: ChatMessage) -> dict[str, object]:
        if message.role is MessageRole.TOOL:
            return {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": message.tool_call_id or "",
                        "content": message.content or "",
                    }
                ],
            }
        blocks: list[dict[str, object]] = []
        if (
            message.role is MessageRole.ASSISTANT
            and message.continuation is not None
            and message.continuation.provider == "anthropic"
        ):
            thinking_blocks = message.continuation.state.get("thinking_blocks")
            if isinstance(thinking_blocks, tuple | list):
                blocks.extend(dict(block) for block in thinking_blocks if isinstance(block, Mapping))
        if message.content:
            blocks.append({"type": "text", "text": message.content})
        if message.role is MessageRole.ASSISTANT:
            blocks.extend(
                {
                    "type": "tool_use",
                    "id": call.id,
                    "name": call.name,
                    "input": _arguments_object(call),
                }
                for call in message.tool_calls
            )
        return {"role": message.role.value, "content": blocks}

    @staticmethod
    def _native_tool(tool: ToolSpec) -> dict[str, object]:
        payload: dict[str, object] = {"name": tool.name, "input_schema": dict(tool.input_schema)}
        if tool.description or tool.metadata.get("has_description", True) is True:
            payload["description"] = tool.description
        return payload

    @staticmethod
    def _tool_choice(value: str | Mapping[str, Any] | None) -> dict[str, object] | None:
        if value is None:
            return None
        if isinstance(value, str):
            mapping = {"auto": "auto", "required": "any", "none": "none"}
            return {"type": mapping.get(value, value)}
        function = value.get("function")
        if isinstance(function, Mapping) and function.get("name"):
            return {"type": "tool", "name": str(function["name"])}
        return dict(value)

    @staticmethod
    def _parse_blocks(
        blocks: list[object],
    ) -> tuple[str, tuple[ToolCall, ...], ProviderContinuation | None]:
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        thinking_blocks: list[dict[str, object]] = []
        for block in blocks:
            if not isinstance(block, Mapping):
                continue
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                text_parts.append(str(block["text"]))
            elif block.get("type") in {"thinking", "redacted_thinking"}:
                thinking_blocks.append(dict(block))
            elif block.get("type") == "tool_use":
                arguments = block.get("input")
                tool_calls.append(
                    ToolCall(
                        str(block.get("id") or ""),
                        str(block.get("name") or ""),
                        json.dumps(arguments if isinstance(arguments, dict) else {}, ensure_ascii=False),
                    )
                )
        continuation = (
            ProviderContinuation("anthropic", {"thinking_blocks": tuple(thinking_blocks)})
            if thinking_blocks
            else None
        )
        return "".join(text_parts), tuple(tool_calls), continuation

    @staticmethod
    def _raise_for_error(data: Mapping[str, object]) -> None:
        if data.get("type") != "error":
            return
        error = data.get("error")
        error_type = str(error.get("type") or "") if isinstance(error, Mapping) else ""
        categories = {
            "authentication_error": ProviderErrorCategory.AUTHENTICATION,
            "permission_error": ProviderErrorCategory.AUTHENTICATION,
            "invalid_request_error": ProviderErrorCategory.INVALID_REQUEST,
            "rate_limit_error": ProviderErrorCategory.RATE_LIMIT,
            "content_filter_error": ProviderErrorCategory.CONTENT_FILTER,
            "overloaded_error": ProviderErrorCategory.CONNECTION,
        }
        category = categories.get(error_type, ProviderErrorCategory.RESPONSE)
        raise ProviderError(
            ProviderErrorDetails(
                category,
                f"Anthropic request failed ({error_type or 'unknown_error'}).",
                retryable=category in {ProviderErrorCategory.RATE_LIMIT, ProviderErrorCategory.CONNECTION},
                provider_code=error_type or None,
                request_id=str(data.get("request_id")) if data.get("request_id") is not None else None,
            )
        )
