"""Bounded, content-free stage measurements; nested durations are not additive."""

from __future__ import annotations

import asyncio
import hashlib
import math
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from functools import wraps
from threading import Lock
from typing import Any, ParamSpec, TypeVar

# Static vocabulary: never accept a manuscript, tool argument, path or exception message as a label.
STAGES = frozenset(
    {
        "revision.total",
        "revision.use_case",
        "revision.prompt",
        "revision.model",
        "revision.punctuation",
        "revision.quality",
        "revision.constraints",
        "revision.system_prompt",
        "polish.total",
        "polish.local",
        "polish.resolve",
        "polish.prompt",
        "polish.model",
        "polish.parse",
        "polish.select",
        "context.collect",
        "context.select",
        "agent.run",
        "agent.model",
        "agent.tool",
        "store.event",
        "store.artifact",
        "store.complete",
        "store.fail",
        "store.plan",
        "store.session",
        "store.message",
        "store.tool_create",
        "store.tool_update",
        "sse.queue_wait",
        "sse.first_yield",
        "sse.first_readable_yield",
        "sse.end",
        "sse.worker",
    }
)
STATUSES = frozenset({"ok", "error", "cancelled", "skipped", "degraded", "rejected", "noop"})
PHASES = frozenset({"complete", "worker_finished", "transport_finished"})
_current: ContextVar[RunMeasurement | None] = ContextVar("performance_measurement", default=None)
_parent: ContextVar[tuple[RunMeasurement, int] | None] = ContextVar("performance_parent", default=None)
P = ParamSpec("P")
R = TypeVar("R")


@dataclass(frozen=True)
class StageRecord:
    span_id: int
    parent_id: int | None
    name: str
    started_offset_ms: float | None
    duration_ms: float | None
    status: str


class StageSpan:
    def __init__(
        self,
        recorder: RunMeasurement | None = None,
        *,
        span_id: int = 0,
        parent_id: int | None = None,
        name: str = "",
        start: float | None = None,
    ) -> None:
        self.recorder = recorder
        self.span_id = span_id
        self.parent_id = parent_id
        self.name = name
        self.start = start
        self.status = "ok"

    def outcome(self, status: str) -> None:
        if status in STATUSES:
            self.status = status

    def finish(self, status: str | None = None) -> None:
        if status is not None:
            self.outcome(status)
        if self.recorder is not None:
            self.recorder.close_span(self)


class RunMeasurement:
    """One request/experiment, thread-safe storage; clock and sink failures are isolated."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] | None = None,
        sink: Callable[[dict[str, Any]], None] | None = None,
        max_spans: int = 128,
    ) -> None:
        self._lock = Lock()
        self._clock = clock or time.perf_counter
        self._sink = sink
        self._limit = max(1, min(512, max_spans))
        self._records: dict[int, StageRecord] = {}
        self._pending: set[int] = set()
        self._published: set[str] = set()
        self._allocated = 0
        self._dropped = 0
        self._timing_failures = 0
        self._sink_failures = 0
        self._run_key: str | None = None
        self._run_status: str | None = None
        self._id = uuid.uuid4().hex
        self._origin = self._now()

    def _now(self) -> float | None:
        try:
            value = self._clock()
            if isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value):
                return float(value)
        except BaseException:  # Observability must not mask business cancellation/errors.
            pass
        with self._lock:
            self._timing_failures += 1
        return None

    def associate_run(self, public_id: str, *, status: str | None = None) -> None:
        # Some public IDs originate in requests; never write their raw text to diagnostic logs.
        if isinstance(public_id, str):
            key = hashlib.sha256(public_id.encode("utf-8", errors="replace")).hexdigest()
            with self._lock:
                self._run_key = key
                self._run_status = (
                    status if status in {"running", "paused", "stopped", "failed", "completed", "pending"} else None
                )

    def start(self, name: str, *, parent_id: int | None = None) -> StageSpan:
        with self._lock:
            if name not in STAGES or self._allocated >= self._limit:
                self._dropped += 1
                return StageSpan()
            self._allocated += 1
            span_id = self._allocated
            self._pending.add(span_id)
        return StageSpan(self, span_id=span_id, parent_id=parent_id, name=name, start=self._now())

    def close_span(self, span: StageSpan) -> None:
        end = self._now()
        offset = None if span.start is None or self._origin is None else (span.start - self._origin) * 1000
        duration = None if end is None or span.start is None or end < span.start else (end - span.start) * 1000
        with self._lock:
            if span.span_id not in self._pending:
                return
            self._pending.remove(span.span_id)
            self._records[span.span_id] = StageRecord(
                span.span_id,
                span.parent_id,
                span.name,
                offset if offset is not None and offset >= 0 else None,
                duration,
                span.status,
            )

    def mark(self, name: str, *, status: str = "ok") -> None:
        span = self.start(name)
        span.finish(status)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "schema_version": 1,
                "measurement_id": self._id,
                "run_key": self._run_key,
                "run_status": self._run_status,
                "stages": [asdict(self._records[key]) for key in sorted(self._records)],
                "pending_spans": len(self._pending),
                "dropped_observations": self._dropped,
                "timing_failures": self._timing_failures,
                "sink_failures": self._sink_failures,
            }

    def publish(self, phase: str) -> None:
        with self._lock:
            if phase not in PHASES or phase in self._published:
                return
            self._published.add(phase)
        if self._sink is not None:
            try:
                self._sink({**self.snapshot(), "phase": phase})
            except BaseException:  # Isolated diagnostic sink, not the business callable.
                with self._lock:
                    self._sink_failures += 1


def current_measurement() -> RunMeasurement | None:
    return _current.get()


@contextmanager
def measurement_scope(recorder: RunMeasurement) -> Iterator[RunMeasurement]:
    current = _current.set(recorder)
    parent = _parent.set(None)
    try:
        yield recorder
    finally:
        _parent.reset(parent)
        _current.reset(current)


@contextmanager
def measure_stage(name: str) -> Iterator[StageSpan]:
    recorder = _current.get()
    parent = _parent.get()
    span = (
        recorder.start(name, parent_id=parent[1] if parent and parent[0] is recorder else None)
        if recorder
        else StageSpan()
    )
    token = _parent.set((recorder, span.span_id)) if recorder and span.span_id else None
    try:
        yield span
    except BaseException as exc:
        if isinstance(exc, asyncio.CancelledError | GeneratorExit | KeyboardInterrupt):
            span.outcome("cancelled")
        elif span.status != "rejected":
            span.outcome("error")
        raise
    finally:
        if token is not None:
            _parent.reset(token)
        span.finish()


def measured(name: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Synchronous operations only; generators/async functions need an explicit scope."""

    def decorate(function: Callable[P, R]) -> Callable[P, R]:
        @wraps(function)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            with measure_stage(name):
                return function(*args, **kwargs)

        return wrapper

    return decorate
