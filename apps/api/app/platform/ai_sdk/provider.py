from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from app.platform.ai_sdk.capabilities import ProviderCapabilities
from app.platform.ai_sdk.contracts import ChatRequest, ChatResponse, StreamEvent


class ProviderHealthStatus(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"
    UNCHECKED = "unchecked"


@dataclass(frozen=True)
class ProviderHealth:
    status: ProviderHealthStatus
    message: str | None = None
    latency_ms: int | None = None


class LLMProvider(Protocol):
    def complete(self, request: ChatRequest) -> ChatResponse: ...

    def stream(self, request: ChatRequest) -> Iterator[StreamEvent]: ...

    def health(self) -> ProviderHealth: ...

    def capabilities(self, model: str) -> ProviderCapabilities: ...
