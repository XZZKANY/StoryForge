from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Iterator

from app.platform.ai_sdk.capabilities import CapabilitySource, ProviderCapabilities
from app.platform.ai_sdk.contracts import ChatRequest, ChatResponse, StreamEvent, StreamEventKind
from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails
from app.platform.ai_sdk.provider import ProviderHealth, ProviderHealthStatus


class DeterministicProvider:
    def __init__(
        self,
        responses: Iterable[ChatResponse | ProviderError] = (),
        streams: Iterable[Iterable[StreamEvent] | ProviderError] = (),
    ) -> None:
        self._responses = deque(responses)
        self._streams = deque(
            stream if isinstance(stream, ProviderError) else tuple(stream) for stream in streams
        )
        self.requests: list[ChatRequest] = []

    def complete(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        if not self._responses:
            raise self._exhausted("complete")
        result = self._responses.popleft()
        if isinstance(result, ProviderError):
            raise result
        return result

    def stream(self, request: ChatRequest) -> Iterator[StreamEvent]:
        self.requests.append(request)
        if self._streams:
            scripted = self._streams.popleft()
            if isinstance(scripted, ProviderError):
                raise scripted
            yield from scripted
            return
        if not self._responses:
            raise self._exhausted("stream")
        response = self._responses.popleft()
        if isinstance(response, ProviderError):
            raise response
        if response.content:
            yield StreamEvent(StreamEventKind.TEXT_DELTA, text=response.content)
        for tool_call in response.tool_calls:
            yield StreamEvent(StreamEventKind.TOOL_CALL_COMPLETED, tool_call=tool_call)
        if response.usage.source != "unavailable" or response.usage.total_tokens:
            yield StreamEvent(StreamEventKind.USAGE, usage=response.usage)
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

    @staticmethod
    def _exhausted(operation: str) -> ProviderError:
        return ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.CONFIGURATION,
                f"Deterministic provider has no scripted {operation} result.",
                provider_code="script_exhausted",
            )
        )
