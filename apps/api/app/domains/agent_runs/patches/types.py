from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, cast


@dataclass(frozen=True)
class PatchProposal:
    """Typed view over the existing proposed-patch wire payload."""

    kind: str
    patch_id: str | int | None
    file_path: str | None
    before: str | None
    after: str | None
    created_by_tool: str
    requires_confirmation: bool
    approval_action: str | None
    approval_command: Mapping[str, Any] | None
    _wire_payload: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> PatchProposal:
        kind = str(payload.get("kind") or "unknown")
        patch_id = payload.get("id")
        return cls(
            kind=kind,
            patch_id=cast(str | int | None, patch_id),
            file_path=_optional_text(payload.get("file_path")),
            before=_optional_text(payload.get("before")),
            after=_optional_text(payload.get("after")),
            created_by_tool=str(payload.get("created_by_tool") or _default_tool_name(kind)),
            requires_confirmation=bool(payload.get("requires_confirmation", True)),
            approval_action=_optional_text(payload.get("approval_action")),
            approval_command=cast(Mapping[str, Any] | None, payload.get("approval_command")),
            _wire_payload=dict(payload),
        )

    def to_payload(self) -> dict[str, Any]:
        return dict(self._wire_payload)


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _default_tool_name(kind: str) -> str:
    if kind == "prose_trim":
        return "project.trim_prose"
    if kind == "repair_patch":
        return "judge.repair"
    return "file.revise"
