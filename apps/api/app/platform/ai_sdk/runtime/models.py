from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.platform.ai_sdk._immutability import freeze_mapping, thaw
from app.platform.ai_sdk.contracts import ChatMessage, MessageRole, ToolCall
from app.platform.ai_sdk.tools import RuntimeArtifact


class RuntimePhase(StrEnum):
    BEFORE_MODEL = "before_model"
    MODEL_COMPLETED = "model_completed"
    TOOLS_PENDING = "tools_pending"
    TOOL_STARTED = "tool_started"
    AFTER_TOOL = "after_tool"
    APPROVAL_REQUIRED = "approval_required"
    INTERRUPTED = "interrupted"
    COMPLETED = "completed"
    FAILED = "failed"


class RuntimeResultStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    APPROVAL_REQUIRED = "approval_required"
    INTERRUPTED = "interrupted"
    RECONCILIATION_REQUIRED = "reconciliation_required"


class ResumeAction(StrEnum):
    APPROVE = "approve"
    DENY = "deny"
    CONTINUE = "continue"


@dataclass(frozen=True)
class ResumeCommand:
    action: ResumeAction
    tool_call_id: str | None = None


@dataclass(frozen=True)
class RuntimeLimits:
    max_rounds: int = 8
    max_tool_calls: int = 32
    max_tool_output_chars: int = 60_000
    max_tokens: int | None = None
    max_cost: float | None = None
    final_message: str = (
        "Tools are no longer available. Finish the response using the information already collected."
    )

    def __post_init__(self) -> None:
        if self.max_rounds < 1:
            raise ValueError("max_rounds must be at least 1")
        if self.max_tool_calls < 0 or self.max_tool_output_chars < 0:
            raise ValueError("tool limits must be non-negative")
        if self.max_tokens is not None and self.max_tokens < 1:
            raise ValueError("max_tokens must be positive when configured")
        if self.max_cost is not None and self.max_cost < 0:
            raise ValueError("max_cost must be non-negative when configured")


@dataclass(frozen=True)
class PendingToolCall:
    call_id: str
    name: str
    arguments: Mapping[str, Any]
    attempt: int = 0

    def __post_init__(self) -> None:
        object.__setattr__(self, "arguments", freeze_mapping(self.arguments))


def _message_to_dict(message: ChatMessage) -> dict[str, Any]:
    return {
        "role": message.role.value,
        "content": message.content,
        "tool_calls": [
            {
                "id": call.id,
                "name": call.name,
                "arguments_json": call.arguments_json,
                "type": call.type,
            }
            for call in message.tool_calls
        ],
        "tool_call_id": message.tool_call_id,
        "name": message.name,
    }


def _message_from_dict(value: Mapping[str, Any]) -> ChatMessage:
    raw_calls = value.get("tool_calls")
    calls = tuple(
        ToolCall(
            str(item.get("id") or ""),
            str(item.get("name") or ""),
            str(item.get("arguments_json") or ""),
            str(item.get("type") or "function"),
        )
        for item in raw_calls
        if isinstance(item, Mapping)
    ) if isinstance(raw_calls, Sequence) and not isinstance(raw_calls, str | bytes) else ()
    return ChatMessage(
        MessageRole(str(value.get("role") or MessageRole.USER.value)),
        str(value["content"]) if value.get("content") is not None else None,
        tool_calls=calls,
        tool_call_id=(
            str(value["tool_call_id"]) if value.get("tool_call_id") is not None else None
        ),
        name=str(value["name"]) if value.get("name") is not None else None,
    )


@dataclass(frozen=True)
class RuntimeCheckpoint:
    run_id: str
    model: str
    phase: RuntimePhase
    messages: tuple[ChatMessage, ...]
    round_count: int = 0
    tool_attempts: int = 0
    tool_output_chars: int = 0
    total_tokens: int = 0
    total_cost: float | None = None
    usage_available: bool = False
    cost_available: bool = False
    pending: PendingToolCall | None = None
    completed_tool_call_ids: tuple[str, ...] = ()
    artifacts: tuple[RuntimeArtifact, ...] = ()
    exhausted: bool = False
    sequence: int = 0
    interruption_reason: str | None = None
    continuation_omitted: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "messages", tuple(self.messages))
        object.__setattr__(self, "completed_tool_call_ids", tuple(self.completed_tool_call_ids))
        object.__setattr__(self, "artifacts", tuple(self.artifacts))

    def to_dict(self) -> dict[str, Any]:
        continuation_omitted = self.continuation_omitted or any(
            message.continuation is not None for message in self.messages
        )
        return {
            "run_id": self.run_id,
            "model": self.model,
            "phase": self.phase.value,
            "messages": [_message_to_dict(message) for message in self.messages],
            "round_count": self.round_count,
            "tool_attempts": self.tool_attempts,
            "tool_output_chars": self.tool_output_chars,
            "total_tokens": self.total_tokens,
            "total_cost": self.total_cost,
            "usage_available": self.usage_available,
            "cost_available": self.cost_available,
            "pending": (
                {
                    "call_id": self.pending.call_id,
                    "name": self.pending.name,
                    "arguments": thaw(self.pending.arguments),
                    "attempt": self.pending.attempt,
                }
                if self.pending is not None
                else None
            ),
            "completed_tool_call_ids": list(self.completed_tool_call_ids),
            "artifacts": [
                {
                    "kind": artifact.kind,
                    "payload": thaw(artifact.payload),
                    "reference": artifact.reference,
                }
                for artifact in self.artifacts
            ],
            "exhausted": self.exhausted,
            "sequence": self.sequence,
            "interruption_reason": self.interruption_reason,
            "continuation_omitted": continuation_omitted,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> RuntimeCheckpoint:
        raw_pending = value.get("pending")
        pending = (
            PendingToolCall(
                str(raw_pending.get("call_id") or ""),
                str(raw_pending.get("name") or ""),
                raw_pending.get("arguments") if isinstance(raw_pending.get("arguments"), Mapping) else {},
                int(raw_pending.get("attempt") or 0),
            )
            if isinstance(raw_pending, Mapping)
            else None
        )
        raw_messages = value.get("messages")
        raw_artifacts = value.get("artifacts")
        return cls(
            run_id=str(value.get("run_id") or ""),
            model=str(value.get("model") or ""),
            phase=RuntimePhase(str(value.get("phase") or RuntimePhase.BEFORE_MODEL.value)),
            messages=tuple(
                _message_from_dict(item)
                for item in raw_messages
                if isinstance(item, Mapping)
            ) if isinstance(raw_messages, Sequence) and not isinstance(raw_messages, str | bytes) else (),
            round_count=int(value.get("round_count") or 0),
            tool_attempts=int(value.get("tool_attempts") or 0),
            tool_output_chars=int(value.get("tool_output_chars") or 0),
            total_tokens=int(value.get("total_tokens") or 0),
            total_cost=(float(value["total_cost"]) if value.get("total_cost") is not None else None),
            usage_available=value.get("usage_available") is True,
            cost_available=value.get("cost_available") is True,
            pending=pending,
            completed_tool_call_ids=tuple(
                str(item) for item in value.get("completed_tool_call_ids", [])
            ),
            artifacts=tuple(
                RuntimeArtifact(
                    str(item.get("kind") or ""),
                    item.get("payload") if isinstance(item.get("payload"), Mapping) else {},
                    str(item["reference"]) if item.get("reference") is not None else None,
                )
                for item in raw_artifacts
                if isinstance(item, Mapping)
            ) if isinstance(raw_artifacts, Sequence) and not isinstance(raw_artifacts, str | bytes) else (),
            exhausted=value.get("exhausted") is True,
            sequence=int(value.get("sequence") or 0),
            interruption_reason=(
                str(value["interruption_reason"])
                if value.get("interruption_reason") is not None
                else None
            ),
            continuation_omitted=value.get("continuation_omitted") is True,
        )


@dataclass(frozen=True)
class RuntimeResult:
    status: RuntimeResultStatus
    run_id: str
    content: str = ""
    messages: tuple[ChatMessage, ...] = ()
    artifacts: tuple[RuntimeArtifact, ...] = ()
    total_tokens: int = 0
    total_cost: float | None = None
    usage_available: bool = False
    cost_available: bool = False
    tool_attempts: int = 0
    exhausted: bool = False
    error_code: str | None = None
    error_message: str | None = None
    checkpoint: RuntimeCheckpoint | None = None
    pending_tool_call_id: str | None = None
