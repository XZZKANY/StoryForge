from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Iterator

from app.platform.ai_sdk.capabilities import CapabilitySource, ProviderCapabilities
from app.platform.ai_sdk.contracts import ChatRequest, ChatResponse, StreamEvent, StreamEventKind
from app.platform.ai_sdk.provider import ProviderHealth, ProviderHealthStatus


class DeterministicProvider:
    def __init__(
        self,
        responses: Iterable[ChatResponse] = (),
        streams: Iterable[Iterable[StreamEvent]] = (),
    ) -> None:
        self._responses = deque(responses)
        self._streams = deque(tuple(stream) for stream in streams)
        self.requests: list[ChatRequest] = []

    def complete(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        if self._responses:
            return self._responses.popleft()
        return ChatResponse(content="")

    def stream(self, request: ChatRequest) -> Iterator[StreamEvent]:
        self.requests.append(request)
        if self._streams:
            yield from self._streams.popleft()
            return
        response = self._responses.popleft() if self._responses else ChatResponse(content="")
        if response.content:
            yield StreamEvent(StreamEventKind.TEXT_DELTA, text=response.content)
        yield StreamEvent(
            StreamEventKind.COMPLETED,
            response=response,
            usage=response.usage,
            finish_reason=response.finish_reason,
        )

    def health(self) -> ProviderHealth:
        return ProviderHealth(ProviderHealthStatus.HEALTHY, message="deterministic")

    def capabilities(self, model: str) -> ProviderCapabilities:
        del model
        return ProviderCapabilities(
            streaming=True,
            native_tools=True,
            parallel_tool_calls=False,
            tool_choice=True,
            reasoning=False,
            usage=True,
            json_response=True,
            source=CapabilitySource.STATIC,
        )
