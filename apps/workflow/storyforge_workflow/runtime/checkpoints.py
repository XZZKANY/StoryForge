from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class RuntimeRecord:
    thread_id: str
    job_run_id: str
    current_node: str
    summary: str
    approval_status: str
    created_at: datetime


class RuntimeCheckpointStore:
    """持久化运行时的最小内存实现，可被真实数据库实现替换。"""

    def __init__(self) -> None:
        self._records: list[RuntimeRecord] = []
        self._state: dict[str, dict[str, Any]] = {}

    def record(self, *, thread_id: str, job_run_id: str, current_node: str, summary: str, approval_status: str) -> RuntimeRecord:
        record = RuntimeRecord(
            thread_id=thread_id,
            job_run_id=job_run_id,
            current_node=current_node,
            summary=summary,
            approval_status=approval_status,
            created_at=datetime.now(timezone.utc),
        )
        self._records.append(record)
        return record

    def save_state(self, thread_id: str, state: dict[str, Any]) -> None:
        self._state[thread_id] = dict(state)

    def load_state(self, thread_id: str) -> dict[str, Any] | None:
        stored = self._state.get(thread_id)
        return None if stored is None else dict(stored)

    def latest(self, thread_id: str) -> RuntimeRecord | None:
        for record in reversed(self._records):
            if record.thread_id == thread_id:
                return record
        return None

    def list_records(self, thread_id: str) -> list[RuntimeRecord]:
        return [record for record in self._records if record.thread_id == thread_id]
