"""Scoped provider observation; no domain, storage, credentials logging, or retry policy."""
from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Protocol

from app.platform.ai_sdk import ChatRequest, ChatResponse, StreamEvent, TokenUsage
from app.platform.ai_sdk.provider import LLMProvider
from app.platform.ai_sdk.stream_usage import retain_error_usage


class ModelObservationError(RuntimeError):
    """Required model evidence failed; domain fallbacks must not hide it."""


class ModelAttempt(Protocol):
    def finish(self, status: str, *, usage: TokenUsage, finish_reason: str | None = None,
               error_code: str | None = None) -> None: ...
    def progress(self, values: Mapping[str, object]) -> None: ...


class ModelObserver(Protocol):
    def begin(self, request: ChatRequest, *, source: Mapping[str, str | None], streaming: bool,
              operation: str, provenance: Mapping[str, Any]) -> ModelAttempt: ...


_observer: ContextVar[ModelObserver | None] = ContextVar("model_observer", default=None)
_operation: ContextVar[tuple[str, Mapping[str, Any]]] = ContextVar("model_operation", default=("agent.model", {}))
_attempt: ContextVar[ModelAttempt | None] = ContextVar("model_attempt", default=None)


@contextmanager
def model_observation_scope(observer: ModelObserver) -> Iterator[None]:
    token = _observer.set(observer)
    try:
        yield
    finally:
        _observer.reset(token)


@contextmanager
def model_operation(name: str, *, provenance: Mapping[str, Any] | None = None) -> Iterator[None]:
    token = _operation.set((name, provenance or {}))
    try:
        yield
    finally:
        _operation.reset(token)


def observe_http_progress(values: Mapping[str, object]) -> None:
    attempt = _attempt.get()
    if attempt is not None:
        attempt.progress(values)


def observe_provider(provider: LLMProvider, source: Mapping[str, str | None]) -> LLMProvider:
    return _ObservedProvider(provider, source)


def _error_code(exc: BaseException) -> str:
    reason = getattr(exc, "reason", None)
    if reason in {"paused", "stopped", "deadline_exceeded"}:
        return reason
    category = getattr(getattr(exc, "details", None), "category", None)
    return category.value if category is not None else "provider_error"


def _finish_attempt(attempt: ModelAttempt, status: str, *, usage: TokenUsage,
                    finish_reason: str | None = None, error_code: str | None = None) -> None:
    try:
        attempt.finish(status, usage=usage, finish_reason=finish_reason, error_code=error_code)
    except Exception as exc:  # noqa: BLE001 - fail closed without discarding received accounting
        retain_error_usage(exc, usage)
        raise


class _ObservedProvider:
    def __init__(self, provider: LLMProvider, source: Mapping[str, str | None]) -> None:
        self._provider, self._source = provider, source

    def _begin(self, request: ChatRequest, *, streaming: bool) -> ModelAttempt | None:
        observer = _observer.get()
        if observer is None:
            return None
        operation, provenance = _operation.get()
        return observer.begin(request, source=self._source, streaming=streaming,
                              operation=operation, provenance=provenance)

    def complete(self, request: ChatRequest) -> ChatResponse:
        attempt = self._begin(request, streaming=False)
        if attempt is None:
            return self._provider.complete(request)
        token = _attempt.set(attempt)
        try:
            response = self._provider.complete(request)
        except BaseException as exc:
            usage = getattr(exc, "usage", None)
            _finish_attempt(attempt, "interrupted" if _error_code(exc) in {"paused", "stopped", "deadline_exceeded"} else "request_failed",
                           usage=usage if isinstance(usage, TokenUsage) else TokenUsage(), error_code=_error_code(exc))
            raise
        else:
            _finish_attempt(attempt, "response_rejected" if response.finish_reason in {"length", "content_filter"}
                           else "response_completed", usage=response.usage, finish_reason=response.finish_reason)
            return response
        finally:
            _attempt.reset(token)

    def stream(self, request: ChatRequest) -> Iterator[StreamEvent]:
        attempt = self._begin(request, streaming=True)
        if attempt is None:
            yield from self._provider.stream(request)
            return
        token = _attempt.set(attempt)
        usage, settling, stream = TokenUsage(), False, None
        try:
            stream = self._provider.stream(request)
            for event in stream:
                if event.usage is not None:
                    usage = event.usage
                if event.response is not None:
                    usage, finish_reason = event.response.usage, event.response.finish_reason
                    settling = True
                    _finish_attempt(attempt, "response_rejected" if finish_reason in {"length", "content_filter"}
                                   else "response_completed", usage=usage, finish_reason=finish_reason)
                yield event
        except BaseException as exc:
            if isinstance(exc, Exception):
                retain_error_usage(exc, usage)
            partial = getattr(exc, "usage", None)
            if not settling:
                status = ("stream_closed" if isinstance(exc, GeneratorExit) else "interrupted"
                          if _error_code(exc) in {"paused", "stopped", "deadline_exceeded"} else "request_failed")
                _finish_attempt(attempt, status,
                               usage=partial if isinstance(partial, TokenUsage) else usage, error_code=_error_code(exc))
            raise
        else:
            if not settling:
                _finish_attempt(attempt, "stream_incomplete", usage=usage)
        finally:
            try:
                close = getattr(stream, "close", None)
                if callable(close):
                    close()
            finally:
                _attempt.reset(token)

    def health(self):
        return self._provider.health()

    def capabilities(self, model: str):
        return self._provider.capabilities(model)
