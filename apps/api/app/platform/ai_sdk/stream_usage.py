"""Preserve the latest cumulative usage snapshot without retaining partial content."""
from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator

from app.platform.ai_sdk.contracts import StreamEvent, TokenUsage


def retain_error_usage(error: Exception, usage: TokenUsage | None) -> None:
    """An inner transport may already carry a more recent snapshot; never sum it."""
    existing = getattr(error, "usage", None)
    if usage is not None and usage.source != "unavailable" and (
        not isinstance(existing, TokenUsage) or existing.source == "unavailable"
    ):
        error.usage = usage


def retaining_stream_usage(
    events: Iterable[StreamEvent],
    *,
    before_next: Callable[[], None] | None = None,
    before_yield: Callable[[], None] | None = None,
) -> Iterator[StreamEvent]:
    iterator = iter(events)
    usage: TokenUsage | None = None
    try:
        while True:
            if before_next is not None:
                before_next()
            try:
                event = next(iterator)
            except StopIteration:
                if before_yield is not None:
                    before_yield()
                return
            observed = event.usage or (event.response.usage if event.response is not None else None)
            if observed is not None and observed.source != "unavailable":
                usage = observed
            # Capture already-read accounting before a cooperative cancel rejects delivery.
            if before_yield is not None:
                before_yield()
            yield event
    except Exception as exc:  # noqa: BLE001 - preserve metadata, never reinterpret control/provider errors
        retain_error_usage(exc, usage)
        raise
    finally:
        close = getattr(iterator, "close", None)
        if callable(close):
            close()
