from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.platform.ai_sdk._immutability import freeze_mapping
from app.platform.ai_sdk.contracts import TokenUsage


@dataclass(frozen=True)
class RuntimeTraceEvent:
    run_id: str
    sequence: int
    round_number: int
    timestamp: str
    kind: str
    payload: Mapping[str, Any] = field(default_factory=freeze_mapping)

    def __post_init__(self) -> None:
        object.__setattr__(self, "payload", freeze_mapping(self.payload))


class RunTracer(Protocol):
    def emit(self, event: RuntimeTraceEvent) -> None: ...


class UsageSink(Protocol):
    def record(self, run_id: str, round_number: int, usage: TokenUsage) -> float | None: ...


class NullRunTracer:
    def emit(self, event: RuntimeTraceEvent) -> None:
        del event


class NullUsageSink:
    def record(self, run_id: str, round_number: int, usage: TokenUsage) -> float | None:
        del run_id, round_number, usage
        return None


class InMemoryRunTracer:
    def __init__(self) -> None:
        self.events: list[RuntimeTraceEvent] = []

    def emit(self, event: RuntimeTraceEvent) -> None:
        self.events.append(event)


class InMemoryUsageSink:
    def __init__(self, *, cost_per_1k_tokens: float | None = None) -> None:
        self.cost_per_1k_tokens = cost_per_1k_tokens
        self.records: list[tuple[str, int, TokenUsage]] = []

    def record(self, run_id: str, round_number: int, usage: TokenUsage) -> float | None:
        self.records.append((run_id, round_number, usage))
        if self.cost_per_1k_tokens is None or usage.source == "unavailable":
            return None
        return usage.total_tokens * self.cost_per_1k_tokens / 1000
