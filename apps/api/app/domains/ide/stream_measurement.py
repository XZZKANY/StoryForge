"""Observe the worker and SSE consumer independently; disconnect is not stop_run."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from app.common.performance import (
    RunMeasurement,
    StageSpan,
    current_measurement,
    measure_stage,
    measurement_scope,
)
from app.common.performance_logging import log_measurement


class StreamMeasurement:
    def __init__(self) -> None:
        self.recorder = current_measurement() or RunMeasurement(sink=log_measurement)
        self._queue_wait = self.recorder.start("sse.queue_wait")
        self._first_yield = False
        self._first_readable = False

    @contextmanager
    def worker(self) -> Iterator[StageSpan]:
        self._queue_wait.finish()
        try:
            with measurement_scope(self.recorder), measure_stage("sse.worker") as span:
                yield span
        finally:
            # Do not depend on a living receiver loop/queue or on pump.finally being reached.
            self.recorder.publish("worker_finished")

    def before_yield(self, payload: Mapping[str, Any]) -> None:
        if not self._first_yield:
            self._first_yield = True
            self.recorder.mark("sse.first_yield")
        if self._first_readable or payload.get("type") not in {
            "agent_result",
            "permission_required",
            "agent_run_completed",
        }:
            return
        value = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
        if value.get("summary") or value.get("proposed_patch"):
            self._first_readable = True
            self.recorder.mark("sse.first_readable_yield")

    def transport_finished(self, status: str) -> None:
        self.recorder.mark("sse.end", status=status)
        # This is consumer termination, NOT worker completion or client receipt.
        self.recorder.publish("transport_finished")
