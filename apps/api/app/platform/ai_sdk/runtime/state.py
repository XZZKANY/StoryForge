from __future__ import annotations

from dataclasses import dataclass, field

from app.platform.ai_sdk.contracts import ChatMessage
from app.platform.ai_sdk.runtime.models import PendingToolCall, RuntimeCheckpoint, RuntimePhase
from app.platform.ai_sdk.tools import RuntimeArtifact


@dataclass
class RuntimeState:
    run_id: str
    model: str
    phase: RuntimePhase
    messages: list[ChatMessage]
    round_count: int = 0
    tool_attempts: int = 0
    tool_output_chars: int = 0
    total_tokens: int = 0
    total_cost: float | None = None
    usage_available: bool = False
    cost_available: bool = False
    pending: PendingToolCall | None = None
    completed_tool_call_ids: list[str] = field(default_factory=list)
    artifacts: list[RuntimeArtifact] = field(default_factory=list)
    exhausted: bool = False
    sequence: int = 0
    interruption_reason: str | None = None
    continuation_omitted: bool = False

    @classmethod
    def from_checkpoint(cls, checkpoint: RuntimeCheckpoint) -> RuntimeState:
        return cls(
            run_id=checkpoint.run_id,
            model=checkpoint.model,
            phase=checkpoint.phase,
            messages=list(checkpoint.messages),
            round_count=checkpoint.round_count,
            tool_attempts=checkpoint.tool_attempts,
            tool_output_chars=checkpoint.tool_output_chars,
            total_tokens=checkpoint.total_tokens,
            total_cost=checkpoint.total_cost,
            usage_available=checkpoint.usage_available,
            cost_available=checkpoint.cost_available,
            pending=checkpoint.pending,
            completed_tool_call_ids=list(checkpoint.completed_tool_call_ids),
            artifacts=list(checkpoint.artifacts),
            exhausted=checkpoint.exhausted,
            sequence=checkpoint.sequence,
            interruption_reason=checkpoint.interruption_reason,
            continuation_omitted=checkpoint.continuation_omitted,
        )

    def checkpoint(self) -> RuntimeCheckpoint:
        return RuntimeCheckpoint(
            run_id=self.run_id,
            model=self.model,
            phase=self.phase,
            messages=tuple(self.messages),
            round_count=self.round_count,
            tool_attempts=self.tool_attempts,
            tool_output_chars=self.tool_output_chars,
            total_tokens=self.total_tokens,
            total_cost=self.total_cost,
            usage_available=self.usage_available,
            cost_available=self.cost_available,
            pending=self.pending,
            completed_tool_call_ids=tuple(self.completed_tool_call_ids),
            artifacts=tuple(self.artifacts),
            exhausted=self.exhausted,
            sequence=self.sequence,
            interruption_reason=self.interruption_reason,
            continuation_omitted=self.continuation_omitted,
        )
