from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

from app.platform.ai_sdk.runtime.models import PendingToolCall, RuntimeCheckpoint
from app.platform.ai_sdk.tools import RuntimeTool, ToolRegistry


class PolicyDecisionKind(StrEnum):
    ALLOW = "allow"
    REQUIRE_APPROVAL = "require_approval"
    DENY = "deny"


@dataclass(frozen=True)
class PolicyDecision:
    kind: PolicyDecisionKind
    reason: str | None = None


class RuntimePolicy(Protocol):
    def decide_tool(self, tool: RuntimeTool, call: PendingToolCall, context: Any) -> PolicyDecision: ...

    def should_retry(self, tool: RuntimeTool, result_retryable: bool, attempt: int) -> bool: ...

    def can_resume_started_tool(self, tool: RuntimeTool, call: PendingToolCall) -> bool: ...


class DefaultRuntimePolicy:
    def __init__(self, *, max_tool_attempts: int = 2) -> None:
        self.max_tool_attempts = max(1, max_tool_attempts)

    def decide_tool(self, tool: RuntimeTool, call: PendingToolCall, context: Any) -> PolicyDecision:
        del call, context
        if tool.requires_approval:
            return PolicyDecision(PolicyDecisionKind.REQUIRE_APPROVAL, "tool_requires_approval")
        return PolicyDecision(PolicyDecisionKind.ALLOW)

    def should_retry(self, tool: RuntimeTool, result_retryable: bool, attempt: int) -> bool:
        return (
            tool.retry_safe
            and tool.idempotent
            and result_retryable
            and attempt < self.max_tool_attempts
        )

    def can_resume_started_tool(self, tool: RuntimeTool, call: PendingToolCall) -> bool:
        del call
        return tool.retry_safe and tool.idempotent


class ToolSelector(Protocol):
    def select(self, registry: ToolRegistry, context: Any) -> tuple[RuntimeTool, ...]: ...


class AllToolsSelector:
    def select(self, registry: ToolRegistry, context: Any) -> tuple[RuntimeTool, ...]:
        del context
        return registry.all()


class CheckpointStore(Protocol):
    def save(self, checkpoint: RuntimeCheckpoint) -> None: ...

    def load(self, run_id: str) -> RuntimeCheckpoint | None: ...


class InMemoryCheckpointStore:
    def __init__(self) -> None:
        self.checkpoints: dict[str, RuntimeCheckpoint] = {}

    def save(self, checkpoint: RuntimeCheckpoint) -> None:
        self.checkpoints[checkpoint.run_id] = checkpoint

    def load(self, run_id: str) -> RuntimeCheckpoint | None:
        return self.checkpoints.get(run_id)


InterruptionCheck = Callable[[str, str, RuntimeCheckpoint], str | None]
