from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, TypeAlias, cast


@dataclass(frozen=True)
class TerminalPatchReference:
    patch_id: str | int | None
    created_by_tool: str | None
    file_path: str | None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> TerminalPatchReference:
        return cls(
            patch_id=cast(str | int | None, payload.get("id")),
            created_by_tool=_optional_text(payload.get("created_by_tool")),
            file_path=_optional_text(payload.get("file_path")),
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.patch_id,
            "created_by_tool": self.created_by_tool,
            "file_path": self.file_path,
        }


@dataclass(frozen=True)
class TerminalLoopStats:
    rounds: int | None
    tool_call_count: int | None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> TerminalLoopStats:
        return cls(
            rounds=_optional_int(payload.get("rounds")),
            tool_call_count=_optional_int(payload.get("tool_call_count")),
        )

    def to_payload(self) -> dict[str, int | None]:
        return {"rounds": self.rounds, "tool_call_count": self.tool_call_count}


@dataclass(frozen=True)
class CompletedEventPayload:
    intent: str | None
    assistant_session_id: int | None
    requires_user_confirmation: bool
    summary: str | None
    has_proposed_patch: bool
    has_review_report: bool
    proposed_patch: TerminalPatchReference | None = None
    chat_loop: TerminalLoopStats | None = None

    @classmethod
    def from_result(
        cls,
        result: Mapping[str, Any],
        agent_result: Mapping[str, Any],
    ) -> CompletedEventPayload:
        raw_summary = agent_result.get("summary")
        summary = raw_summary[:4000] if isinstance(raw_summary, str) else None
        raw_patch = result.get("proposed_patch")
        proposed_patch = TerminalPatchReference.from_payload(raw_patch) if isinstance(raw_patch, dict) else None
        raw_chat_loop = agent_result.get("chat_loop")
        chat_loop = TerminalLoopStats.from_payload(raw_chat_loop) if isinstance(raw_chat_loop, dict) else None
        return cls(
            intent=_optional_text(result.get("intent")),
            assistant_session_id=_optional_int(result.get("assistant_session_id")),
            requires_user_confirmation=bool(agent_result.get("requires_user_confirmation")),
            summary=summary,
            has_proposed_patch=proposed_patch is not None,
            has_review_report=isinstance(agent_result.get("review_report"), dict),
            proposed_patch=proposed_patch,
            chat_loop=chat_loop,
        )

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "intent": self.intent,
            "assistant_session_id": self.assistant_session_id,
            "requires_user_confirmation": self.requires_user_confirmation,
            "summary": self.summary,
            "has_proposed_patch": self.has_proposed_patch,
            "has_review_report": self.has_review_report,
        }
        if self.proposed_patch is not None:
            payload["proposed_patch"] = self.proposed_patch.to_payload()
        if self.chat_loop is not None:
            payload["chat_loop"] = self.chat_loop.to_payload()
        return payload


@dataclass(frozen=True)
class FailedEventPayload:
    reason: str | None
    session_id: str | None
    run_id: str | None
    runtime: str | None
    _wire_payload: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> FailedEventPayload:
        return cls(
            reason=_optional_text(payload.get("reason")),
            session_id=_optional_text(payload.get("session_id")),
            run_id=_optional_text(payload.get("run_id")),
            runtime=_optional_text(payload.get("runtime")),
            _wire_payload=dict(payload),
        )

    def to_payload(self) -> dict[str, Any]:
        return dict(self._wire_payload)


TerminalEventPayload: TypeAlias = CompletedEventPayload | FailedEventPayload


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None
