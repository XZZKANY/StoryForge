from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Any


def _immutable_mapping(value: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    return MappingProxyType(dict(value or {}))


class MessageRole(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments_json: str
    type: str = "function"

    @classmethod
    def from_openai(cls, payload: Mapping[str, Any]) -> ToolCall | None:
        function = payload.get("function")
        if not isinstance(function, Mapping):
            return None
        arguments = function.get("arguments")
        arguments_json = (
            json.dumps(arguments, ensure_ascii=False)
            if isinstance(arguments, dict | list)
            else str(arguments or "")
        )
        return cls(
            id=str(payload.get("id") or ""),
            type=str(payload.get("type") or "function"),
            name=str(function.get("name") or ""),
            arguments_json=arguments_json,
        )

    def to_openai(self) -> dict[str, object]:
        return {
            "id": self.id,
            "type": self.type,
            "function": {"name": self.name, "arguments": self.arguments_json},
        }


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: Mapping[str, Any]
    metadata: Mapping[str, Any] = field(default_factory=_immutable_mapping)

    def __post_init__(self) -> None:
        object.__setattr__(self, "input_schema", _immutable_mapping(self.input_schema))
        object.__setattr__(self, "metadata", _immutable_mapping(self.metadata))

    @classmethod
    def from_openai(cls, payload: Mapping[str, Any]) -> ToolSpec | None:
        function = payload.get("function")
        if not isinstance(function, Mapping):
            return None
        parameters = function.get("parameters")
        if not isinstance(parameters, Mapping):
            parameters = {}
        return cls(
            name=str(function.get("name") or ""),
            description=str(function.get("description") or ""),
            input_schema=parameters,
            metadata={
                "type": str(payload.get("type") or "function"),
                "has_description": "description" in function,
                "top_level": {
                    key: value for key, value in payload.items() if key not in {"type", "function"}
                },
                "function": {
                    key: value
                    for key, value in function.items()
                    if key not in {"name", "description", "parameters"}
                },
            },
        )

    def to_openai(self) -> dict[str, object]:
        function: dict[str, object] = {"name": self.name, "parameters": dict(self.input_schema)}
        if self.description or self.metadata.get("has_description", True) is True:
            function["description"] = self.description
        function_extra = self.metadata.get("function")
        if isinstance(function_extra, Mapping):
            function.update(function_extra)
        payload: dict[str, object] = {
            "type": str(self.metadata.get("type") or "function"),
            "function": function,
        }
        top_level_extra = self.metadata.get("top_level")
        if isinstance(top_level_extra, Mapping):
            payload.update(top_level_extra)
        return payload


@dataclass(frozen=True)
class ChatMessage:
    role: MessageRole
    content: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str | None = None
    name: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=_immutable_mapping)

    def __post_init__(self) -> None:
        object.__setattr__(self, "tool_calls", tuple(self.tool_calls))
        object.__setattr__(self, "metadata", _immutable_mapping(self.metadata))

    @classmethod
    def from_openai(cls, payload: Mapping[str, Any]) -> ChatMessage:
        role = MessageRole(str(payload.get("role") or "user"))
        raw_calls = payload.get("tool_calls")
        tool_calls = tuple(
            call
            for item in raw_calls
            if isinstance(item, Mapping) and (call := ToolCall.from_openai(item)) is not None
        ) if isinstance(raw_calls, list) else ()
        known = {"role", "content", "tool_calls", "tool_call_id", "name"}
        return cls(
            role=role,
            content=payload.get("content") if isinstance(payload.get("content"), str) else None,
            tool_calls=tool_calls,
            tool_call_id=str(payload["tool_call_id"]) if payload.get("tool_call_id") is not None else None,
            name=str(payload["name"]) if payload.get("name") is not None else None,
            metadata={key: value for key, value in payload.items() if key not in known},
        )

    def to_openai(self) -> dict[str, object]:
        payload: dict[str, object] = {"role": self.role.value, "content": self.content}
        if self.tool_calls:
            payload["tool_calls"] = [call.to_openai() for call in self.tool_calls]
        if self.tool_call_id is not None:
            payload["tool_call_id"] = self.tool_call_id
        if self.name is not None:
            payload["name"] = self.name
        payload.update(self.metadata)
        return payload


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cached_input_tokens: int | None = None
    reasoning_tokens: int | None = None
    source: str = "unavailable"

    @classmethod
    def from_legacy(cls, payload: Mapping[str, Any]) -> TokenUsage:
        return cls(
            input_tokens=max(0, int(payload.get("prompt_tokens") or 0)),
            output_tokens=max(0, int(payload.get("completion_tokens") or 0)),
            total_tokens=max(0, int(payload.get("token_usage") or 0)),
            cached_input_tokens=(
                max(0, int(payload["cache_hit_tokens"]))
                if isinstance(payload.get("cache_hit_tokens"), int)
                and not isinstance(payload.get("cache_hit_tokens"), bool)
                else None
            ),
            source=str(payload.get("token_usage_source") or "unavailable"),
        )

    def to_legacy(self) -> dict[str, int | str | None]:
        return {
            "token_usage": self.total_tokens,
            "prompt_tokens": self.input_tokens,
            "completion_tokens": self.output_tokens,
            "cache_hit_tokens": self.cached_input_tokens,
            "token_usage_source": self.source,
        }


@dataclass(frozen=True)
class ChatRequest:
    model: str
    messages: tuple[ChatMessage, ...]
    tools: tuple[ToolSpec, ...] = ()
    temperature: float | None = None
    max_tokens: int | None = None
    tool_choice: str | Mapping[str, Any] | None = None
    reasoning_effort: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=_immutable_mapping)

    def __post_init__(self) -> None:
        object.__setattr__(self, "messages", tuple(self.messages))
        object.__setattr__(self, "tools", tuple(self.tools))
        object.__setattr__(self, "metadata", _immutable_mapping(self.metadata))


@dataclass(frozen=True)
class ChatResponse:
    content: str
    tool_calls: tuple[ToolCall, ...] = ()
    usage: TokenUsage = field(default_factory=TokenUsage)
    finish_reason: str | None = None
    response_id: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=_immutable_mapping)

    def __post_init__(self) -> None:
        object.__setattr__(self, "tool_calls", tuple(self.tool_calls))
        object.__setattr__(self, "metadata", _immutable_mapping(self.metadata))


class StreamEventKind(StrEnum):
    TEXT_DELTA = "text_delta"
    REASONING_DELTA = "reasoning_delta"
    TOOL_CALL_DELTA = "tool_call_delta"
    TOOL_CALL_COMPLETED = "tool_call_completed"
    USAGE = "usage"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass(frozen=True)
class StreamEvent:
    kind: StreamEventKind
    text: str | None = None
    tool_call: ToolCall | None = None
    usage: TokenUsage | None = None
    response: ChatResponse | None = None
    finish_reason: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=_immutable_mapping)

    def __post_init__(self) -> None:
        object.__setattr__(self, "metadata", _immutable_mapping(self.metadata))


def messages_from_openai(items: Sequence[Mapping[str, Any]]) -> tuple[ChatMessage, ...]:
    return tuple(ChatMessage.from_openai(item) for item in items)


def tools_from_openai(items: Sequence[Mapping[str, Any]] | None) -> tuple[ToolSpec, ...]:
    if not items:
        return ()
    return tuple(
        spec for item in items if (spec := ToolSpec.from_openai(item)) is not None
    )
