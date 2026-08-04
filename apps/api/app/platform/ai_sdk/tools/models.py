from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.platform.ai_sdk._immutability import freeze_mapping, thaw
from app.platform.ai_sdk.contracts import ToolSpec


class ToolResultStatus(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"


@dataclass(frozen=True)
class RuntimeArtifact:
    kind: str
    payload: Mapping[str, Any]
    reference: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "payload", freeze_mapping(self.payload))


@dataclass(frozen=True)
class RuntimeToolResult:
    status: ToolResultStatus
    output: Mapping[str, Any] = field(default_factory=freeze_mapping)
    artifacts: tuple[RuntimeArtifact, ...] = ()
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "output", freeze_mapping(self.output))
        object.__setattr__(self, "artifacts", tuple(self.artifacts))
        if self.status is ToolResultStatus.SUCCESS:
            object.__setattr__(self, "retryable", False)

    def to_output(self) -> dict[str, Any]:
        return thaw(self.output)

    @classmethod
    def success(
        cls,
        output: Mapping[str, Any],
        *,
        artifacts: tuple[RuntimeArtifact, ...] = (),
    ) -> RuntimeToolResult:
        return cls(ToolResultStatus.SUCCESS, output=output, artifacts=artifacts)

    @classmethod
    def failure(
        cls,
        code: str,
        message: str,
        *,
        retryable: bool = False,
    ) -> RuntimeToolResult:
        return cls(
            ToolResultStatus.FAILURE,
            error_code=code,
            error_message=message,
            retryable=retryable,
        )


ToolHandler = Callable[[Any, Mapping[str, Any]], RuntimeToolResult]


@dataclass(frozen=True)
class RuntimeTool:
    spec: ToolSpec
    handler: ToolHandler
    output_schema: Mapping[str, Any] = field(default_factory=freeze_mapping)
    retry_safe: bool = False
    idempotent: bool = False
    requires_approval: bool = False
    metadata: Mapping[str, Any] = field(default_factory=freeze_mapping)

    def __post_init__(self) -> None:
        object.__setattr__(self, "output_schema", freeze_mapping(self.output_schema))
        object.__setattr__(self, "metadata", freeze_mapping(self.metadata))
