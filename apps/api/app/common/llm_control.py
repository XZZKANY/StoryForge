"""Optional run-local control over the existing synchronous LLM transport.

Cancellation is cooperative: an in-flight urllib read still owns its socket
until it returns or times out. No background thread, replacement HTTP stack,
provider payload, or application/database dependency belongs here.
"""
from __future__ import annotations

import math
import time
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import TypeVar

from app.common.llm_observation import observe_http_progress
from app.platform.ai_sdk.contracts import TokenUsage


class LLMRunInterrupted(Exception):
    """Control-plane exit, deliberately unrelated to provider/timeout errors."""

    def __init__(self, reason: str, *, usage: TokenUsage | None = None) -> None:
        super().__init__("LLM run interrupted.")
        self.reason = reason
        self.usage = usage


@dataclass
class LLMRunControl:
    check_interruption: Callable[[str], str | None]
    deadline: float | None = None
    on_progress: Callable[[dict[str, object]], None] | None = None
    clock: Callable[[], float] = field(default_factory=lambda: time.monotonic)
    wait: Callable[[float], None] = field(default_factory=lambda: time.sleep)
    _reason: str | None = field(default=None, init=False)
    _request_number: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        if self.deadline is not None and not math.isfinite(self.deadline):
            raise ValueError("deadline must be finite")

    def check(self, boundary: str) -> None:
        if self._reason is None:
            self._reason = self.check_interruption(boundary)
        if self._reason is None and self.deadline is not None and self.clock() >= self.deadline:
            self._reason = "deadline_exceeded"
        if self._reason is not None:
            raise LLMRunInterrupted(self._reason)

    def emit(self, phase: str, **values: object) -> None:
        progress = {"phase": phase, "request_number": self._request_number, **values}
        observe_http_progress(progress)
        if self.on_progress is not None:
            self.on_progress(progress)

    def request_timeout(self, configured: float) -> float:
        self.check("before_http_request")
        timeout = configured
        if self.deadline is not None:
            timeout = min(timeout, self.deadline - self.clock())
            if timeout <= 0:
                self._reason = "deadline_exceeded"
                raise LLMRunInterrupted(self._reason)
        self._request_number += 1
        self.emit("request_started", timeout_seconds=timeout)
        # A progress observer may itself cause control state to change.
        self.check("before_http_dispatch")
        if self.deadline is not None:
            timeout = min(timeout, self.deadline - self.clock())
            if timeout <= 0:
                self._reason = "deadline_exceeded"
                raise LLMRunInterrupted(self._reason)
        return timeout

    def wait_for_retry(self, delay: float) -> None:
        if not math.isfinite(delay) or delay < 0:
            raise ValueError("retry delay must be finite and non-negative")
        self.check("before_retry_wait")
        end = self.clock() + delay
        self.emit("retry_wait", delay_seconds=delay)
        while True:
            self.check("retry_wait")
            remaining = end - self.clock()
            if remaining <= 0:
                break
            if self.deadline is not None:
                remaining = min(remaining, self.deadline - self.clock())
            if remaining > 0:
                self.wait(min(0.1, remaining))
        self.check("before_retry_dispatch")
        self.emit("retry_started")


_current_control: ContextVar[LLMRunControl | None] = ContextVar("llm_run_control", default=None)


@contextmanager
def llm_run_control(control: LLMRunControl) -> Iterator[LLMRunControl]:
    token = _current_control.set(control)
    try:
        yield control
    finally:
        _current_control.reset(token)


def request_timeout(configured: float) -> float:
    control = _current_control.get()
    return configured if control is None else control.request_timeout(configured)


def wait_for_retry(delay: float) -> None:
    control = _current_control.get()
    if control is not None:
        control.wait_for_retry(delay)
    else:
        if delay > 0:
            # Preserve the existing monkeypatchable time.sleep path outside runs.
            time.sleep(delay)
        observe_http_progress({"phase": "retry_started"})


def check_run_interruption(boundary: str) -> None:
    control = _current_control.get()
    if control is not None:
        control.check(boundary)


def has_run_control() -> bool:
    return _current_control.get() is not None


_StreamItem = TypeVar("_StreamItem")


def controlled_iterator(
    items: Iterable[_StreamItem], *, check_after_read: bool = True,
) -> Iterator[_StreamItem]:
    """Check cooperative boundaries without replaying any previously yielded item."""
    iterator = iter(items)
    try:
        while True:
            check_run_interruption("before_stream_read")
            try:
                item = next(iterator)
            except StopIteration:
                return
            if check_after_read:
                check_run_interruption("before_stream_yield")
            yield item
    finally:
        close = getattr(iterator, "close", None)
        if callable(close):
            close()
