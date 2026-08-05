"""结构化拆书运行的进程内取消事件注册表。"""

from __future__ import annotations

from threading import Event, Lock

_EVENTS: dict[str, Event] = {}
_LOCK = Lock()


def prepare_breakdown_cancellation(analysis_id: str) -> Event:
    event = Event()
    with _LOCK:
        _EVENTS[analysis_id] = event
    return event


def request_breakdown_cancel(analysis_id: str) -> bool:
    with _LOCK:
        event = _EVENTS.get(analysis_id)
    if event is None:
        return False
    event.set()
    return True


def release_breakdown_cancellation(analysis_id: str) -> None:
    with _LOCK:
        _EVENTS.pop(analysis_id, None)
