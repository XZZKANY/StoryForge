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

RawCompleteTransport = Callable[[str, dict[str, object]], tuple[dict[str, object], float]]
RawStreamTransport = Callable[[str, dict[str, object]], Iterable[Mapping[str, object]]]

_THINKING_BUDGETS = {"low": 1024, "medium": 4096, "high": 8192}
_FINISH_REASONS = {
    "STOP": "stop",
    "MAX_TOKENS": "length",
    "SAFETY": "content_filter",
    "RECITATION": "content_filter",
    "BLOCKLIST": "content_filter",
    "PROHIBITED_CONTENT": "content_filter",
    "SPII": "content_filter",
    "MALFORMED_FUNCTION_CALL": "invalid_request",
}


def _non_negative_int(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _json_object(value: str, *, label: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
    except json.JSONDecodeError as exc:
        raise ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.INVALID_REQUEST,
                f"{label} must contain valid JSON.",
                provider_code="invalid_json",
            )
        ) from exc
    if not isinstance(parsed, dict):
        raise ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.INVALID_REQUEST,
                f"{label} must contain a JSON object.",
                provider_code="invalid_json_object",
            )
        )
    return parsed


def _usage(payload: object, *, prior: TokenUsage | None = None) -> TokenUsage:
    data = payload if isinstance(payload, Mapping) else {}
    input_tokens = _non_negative_int(data.get("promptTokenCount")) or (prior.input_tokens if prior else 0)
    output_tokens = _non_negative_int(data.get("candidatesTokenCount")) or (prior.output_tokens if prior else 0)
    total_tokens = _non_negative_int(data.get("totalTokenCount")) or input_tokens + output_tokens
    cached = _non_negative_int(data.get("cachedContentTokenCount"))
    reasoning = _non_negative_int(data.get("thoughtsTokenCount"))
    return TokenUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        cached_input_tokens=cached or (prior.cached_input_tokens if prior else None),
        reasoning_tokens=reasoning or (prior.reasoning_tokens if prior else None),
        source="provider_usage",
    )


def _finish_reason(value: object) -> str | None:
    if value is None:
        return None
    raw = str(value).upper()
    return _FINISH_REASONS.get(raw, raw.lower())


class GeminiProvider:
    """Gemini generateContent adapter with native parts contained here."""

    def __init__(
        self,
        *,
        complete_transport: RawCompleteTransport,
        stream_transport: RawStreamTransport | None = None,
        configured_capabilities: Mapping[str, ProviderCapabilities] | None = None,
        verified_capabilities: Mapping[str, ProviderCapabilities] | None = None,
    ) -> None:
        self._complete_transport = complete_transport
        self._stream_transport = stream_transport
        self._configured_capabilities = configured_capabilities
        self._verified_capabilities = verified_capabilities

    def complete(self, request: ChatRequest) -> ChatResponse:
        data, started_at = self._complete_transport(request.model, self.build_payload(request))
        self._raise_for_error(data)
        candidate = self._first_candidate(data)
        content, tool_calls, continuation = self._parse_candidate(candidate)
        finish_reason = _finish_reason(candidate.get("finishReason"))
        self._raise_for_blocked_finish(finish_reason, candidate.get("finishReason"))
        metadata: dict[str, object] = {
            "latency_ms": max(0, int((time.monotonic() - started_at) * 1000))
        }
        if continuation is not None:
            metadata["reasoning_present"] = True
        return ChatResponse(
            content=content,
            tool_calls=tool_calls,
            usage=_usage(data.get("usageMetadata")),
            finish_reason=finish_reason,
            response_id=str(data.get("responseId")) if data.get("responseId") is not None else None,
            metadata=metadata,
            continuation=continuation,
        )

    def stream(self, request: ChatRequest) -> Iterator[StreamEvent]:
        if self._stream_transport is None:
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.UNSUPPORTED,
                    "Gemini provider does not have a streaming transport.",
                )
            )
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        usage = TokenUsage()
        finish_reason: str | None = None
        response_id: str | None = None
        reasoning_present = False
        function_call_signatures: dict[str, str] = {}

        for frame in self._stream_transport(request.model, self.build_payload(request)):
            self._raise_for_error(frame)
            if frame.get("responseId") is not None:
                response_id = str(frame["responseId"])
            candidates = frame.get("candidates")
            if isinstance(candidates, list) and candidates and isinstance(candidates[0], Mapping):
                candidate = candidates[0]
                content = candidate.get("content")
                parts = content.get("parts") if isinstance(content, Mapping) else None
                if isinstance(parts, list):
                    for index, part in enumerate(parts):
                        if not isinstance(part, Mapping):
                            continue
                        if part.get("thought") is True and isinstance(part.get("text"), str):
                            reasoning_present = True
                            yield StreamEvent(StreamEventKind.REASONING_DELTA, text=str(part["text"]))
                        elif isinstance(part.get("text"), str):
                            text = str(part["text"])
                            text_parts.append(text)
                            yield StreamEvent(StreamEventKind.TEXT_DELTA, text=text)
                        function_call = part.get("functionCall")
                        if isinstance(function_call, Mapping):
                            call = self._tool_call(function_call, index=index)
                            tool_calls.append(call)
                            signature = part.get("thoughtSignature")
                            if isinstance(signature, str) and signature:
                                function_call_signatures[call.id] = signature
                            yield StreamEvent(StreamEventKind.TOOL_CALL_COMPLETED, tool_call=call)
                current_finish = _finish_reason(candidate.get("finishReason"))
                if current_finish is not None:
                    finish_reason = current_finish
                    self._raise_for_blocked_finish(finish_reason, candidate.get("finishReason"))
            if isinstance(frame.get("usageMetadata"), Mapping):
                usage = _usage(frame.get("usageMetadata"), prior=usage)
                yield StreamEvent(StreamEventKind.USAGE, usage=usage)

        metadata = {"reasoning_present": True} if reasoning_present else {}
        continuation = (
            ProviderContinuation(
                "gemini", {"function_call_signatures": function_call_signatures}
            )
            if function_call_signatures
            else None
        )
        response = ChatResponse(
            content="".join(text_parts),
            tool_calls=tuple(tool_calls),
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
                json_response=True,
                reason="Thinking and model token limits require a model-specific descriptor.",
            ),
        )

    def build_payload(self, request: ChatRequest) -> dict[str, object]:
        system = "\n\n".join(
            message.content or "" for message in request.messages if message.role is MessageRole.SYSTEM
        ).strip()
        call_names = {
            call.id: call.name
            for message in request.messages
            for call in message.tool_calls
            if call.id and call.name
        }
        payload: dict[str, object] = {
            "contents": [
                self._native_content(message, call_names)
                for message in request.messages
                if message.role is not MessageRole.SYSTEM
            ]
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        generation_config: dict[str, object] = {}
        if request.temperature is not None:
            generation_config["temperature"] = request.temperature
        if request.max_tokens is not None and request.max_tokens > 0:
            generation_config["maxOutputTokens"] = request.max_tokens
        if request.reasoning_effort:
            budget = _THINKING_BUDGETS.get(request.reasoning_effort)
            if budget is None:
                raise ProviderError(
                    ProviderErrorDetails(
                        ProviderErrorCategory.INVALID_REQUEST,
                        "Gemini reasoning effort must be low, medium, or high.",
                        provider_code="invalid_reasoning_effort",
                    )
                )
            generation_config["thinkingConfig"] = {"thinkingBudget": budget}
        if generation_config:
            payload["generationConfig"] = generation_config
        if request.tools:
            payload["tools"] = [
                {"functionDeclarations": [self._function_declaration(tool) for tool in request.tools]}
            ]
            tool_config = self._tool_config(request.tool_choice)
            if tool_config is not None:
                payload["toolConfig"] = {"functionCallingConfig": tool_config}
        return payload

    @staticmethod
    def _native_content(message: ChatMessage, call_names: Mapping[str, str]) -> dict[str, object]:
        if message.role is MessageRole.TOOL:
            name = message.name or call_names.get(message.tool_call_id or "")
            if not name:
                raise ProviderError(
                    ProviderErrorDetails(
                        ProviderErrorCategory.INVALID_REQUEST,
                        "Gemini tool results require a tool name or a correlated tool call id.",
                        provider_code="missing_tool_name",
                    )
                )
            response = _json_object(message.content or "{}", label=f"Tool result {name!r}")
            return {
                "role": "user",
                "parts": [{"functionResponse": {"name": name, "response": response}}],
            }
        parts: list[dict[str, object]] = []
        if message.content:
            parts.append({"text": message.content})
        if message.role is MessageRole.ASSISTANT:
            signatures: Mapping[str, object] = {}
            if message.continuation is not None and message.continuation.provider == "gemini":
                raw_signatures = message.continuation.state.get("function_call_signatures")
                if isinstance(raw_signatures, Mapping):
                    signatures = raw_signatures
            parts.extend(
                GeminiProvider._native_function_call(call, signatures)
                for call in message.tool_calls
            )
        role = "model" if message.role is MessageRole.ASSISTANT else "user"
        return {"role": role, "parts": parts}

    @staticmethod
    def _native_function_call(
        call: ToolCall, signatures: Mapping[str, object]
    ) -> dict[str, object]:
        part: dict[str, object] = {
            "functionCall": {
                "id": call.id,
                "name": call.name,
                "args": _json_object(call.arguments_json, label=f"Tool call {call.name!r}"),
            }
        }
        signature = signatures.get(call.id)
        if isinstance(signature, str) and signature:
            part["thoughtSignature"] = signature
        return part

    @staticmethod
    def _function_declaration(tool: ToolSpec) -> dict[str, object]:
        declaration: dict[str, object] = {
            "name": tool.name,
            "parameters": dict(tool.input_schema),
        }
        if tool.description or tool.metadata.get("has_description", True) is True:
            declaration["description"] = tool.description
        return declaration

    @staticmethod
    def _tool_config(value: str | Mapping[str, Any] | None) -> dict[str, object] | None:
        if value is None:
            return None
        if isinstance(value, str):
            modes = {"auto": "AUTO", "required": "ANY", "none": "NONE"}
            return {"mode": modes.get(value, value.upper())}
        function = value.get("function")
        if isinstance(function, Mapping) and function.get("name"):
            return {"mode": "ANY", "allowedFunctionNames": [str(function["name"])]}
        return dict(value)

    @staticmethod
    def _first_candidate(data: Mapping[str, object]) -> Mapping[str, object]:
        candidates = data.get("candidates")
        if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], Mapping):
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.RESPONSE,
                    "Gemini response is missing candidates.",
                    provider_code="missing_candidates",
                )
            )
        return candidates[0]

    @classmethod
    def _parse_candidate(
        cls, candidate: Mapping[str, object]
    ) -> tuple[str, tuple[ToolCall, ...], ProviderContinuation | None]:
        content = candidate.get("content")
        parts = content.get("parts") if isinstance(content, Mapping) else None
        if not isinstance(parts, list):
            return "", (), None
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        reasoning_present = False
        signatures: dict[str, str] = {}
        for index, part in enumerate(parts):
            if not isinstance(part, Mapping):
                continue
            if part.get("thought") is True:
                reasoning_present = True
            elif isinstance(part.get("text"), str):
                text_parts.append(str(part["text"]))
            function_call = part.get("functionCall")
            if isinstance(function_call, Mapping):
                call = cls._tool_call(function_call, index=index)
                tool_calls.append(call)
                signature = part.get("thoughtSignature")
                if isinstance(signature, str) and signature:
                    signatures[call.id] = signature
        continuation = (
            ProviderContinuation("gemini", {"function_call_signatures": signatures})
            if signatures
            else None
        )
        if reasoning_present and continuation is None:
            continuation = ProviderContinuation("gemini", {})
        return "".join(text_parts), tuple(tool_calls), continuation

    @staticmethod
    def _tool_call(payload: Mapping[str, object], *, index: int) -> ToolCall:
        arguments = payload.get("args")
        return ToolCall(
            str(payload.get("id") or f"gemini-call-{index}"),
            str(payload.get("name") or ""),
            json.dumps(arguments if isinstance(arguments, dict) else {}, ensure_ascii=False),
        )

    @staticmethod
    def _raise_for_blocked_finish(finish_reason: str | None, provider_reason: object) -> None:
        if finish_reason == "content_filter":
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.CONTENT_FILTER,
                    "Gemini blocked the response for safety reasons.",
                    provider_code=str(provider_reason) if provider_reason is not None else None,
                )
            )
        if finish_reason == "invalid_request":
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.INVALID_REQUEST,
                    "Gemini returned a malformed function call.",
                    provider_code=str(provider_reason) if provider_reason is not None else None,
                )
            )

    @staticmethod
    def _raise_for_error(data: Mapping[str, object]) -> None:
        error = data.get("error")
        if not isinstance(error, Mapping):
            return
        status = str(error.get("status") or "")
        code = _non_negative_int(error.get("code")) or None
        categories = {
            "UNAUTHENTICATED": ProviderErrorCategory.AUTHENTICATION,
            "PERMISSION_DENIED": ProviderErrorCategory.AUTHENTICATION,
            "INVALID_ARGUMENT": ProviderErrorCategory.INVALID_REQUEST,
            "FAILED_PRECONDITION": ProviderErrorCategory.INVALID_REQUEST,
            "RESOURCE_EXHAUSTED": ProviderErrorCategory.RATE_LIMIT,
            "DEADLINE_EXCEEDED": ProviderErrorCategory.TIMEOUT,
            "UNAVAILABLE": ProviderErrorCategory.CONNECTION,
        }
        category = categories.get(status, ProviderErrorCategory.RESPONSE)
        raise ProviderError(
            ProviderErrorDetails(
                category,
                f"Gemini request failed ({status or 'unknown_error'}).",
                retryable=category
                in {
                    ProviderErrorCategory.RATE_LIMIT,
                    ProviderErrorCategory.TIMEOUT,
                    ProviderErrorCategory.CONNECTION,
                },
                status_code=code,
                provider_code=status or None,
            )
        )
