"""Bounded worker-to-async queue; detaching a reader never cancels its run."""
from __future__ import annotations

import asyncio
import threading
from typing import Any


class QueueGetTimeout(Exception):
    """No item became available within the requested wait window."""


class WorkerStreamQueue:
    def __init__(self, loop: asyncio.AbstractEventLoop, *, capacity: int = 64) -> None:
        self._loop = loop
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._slots = threading.BoundedSemaphore(capacity)
        self._closed = threading.Event()

    def put(self, item: dict[str, Any]) -> None:
        while not self._closed.is_set():
            if self._slots.acquire(timeout=0.05):
                try:
                    self._loop.call_soon_threadsafe(self._deliver, item)
                except RuntimeError:
                    self._slots.release()
                return

    def _deliver(self, item: dict[str, Any]) -> None:
        if self._closed.is_set():
            self._slots.release()
        else:
            self._queue.put_nowait(item)

    async def get(self, timeout: float | None = None) -> dict[str, Any]:
        if timeout is None:
            item = await self._queue.get()
        else:
            try:
                item = await asyncio.wait_for(self._queue.get(), timeout)
            except TimeoutError:
                # The semaphore slot is only released for a dequeued item; a timed-out
                # wait leaves capacity untouched.
                raise QueueGetTimeout from None
        self._slots.release()
        return item

    def close(self) -> None:
        self._closed.set()
        while not self._queue.empty():
            self._queue.get_nowait()
            self._slots.release()
