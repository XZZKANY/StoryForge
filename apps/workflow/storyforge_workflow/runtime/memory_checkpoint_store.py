from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from storyforge_workflow.runtime.checkpoint_records import (
    RuntimeModelRunRecord,
    RuntimeRecord,
    RuntimeStateSnapshot,
    snapshot_from_state,
)
from storyforge_workflow.state import checkpoint_reference_state


class InMemoryRuntimeCheckpointStore:
    """显式测试替身：只在调用方主动选择时使用进程内存保存运行时记录。"""

    def __init__(self) -> None:
        self._records: list[RuntimeRecord] = []
        self._model_runs: list[RuntimeModelRunRecord] = []
        self._state: dict[str, dict[str, Any]] = {}

    def record(
        self, *, thread_id: str, job_run_id: str, current_node: str, summary: str, approval_status: str
    ) -> RuntimeRecord:
        record = RuntimeRecord(
            thread_id=thread_id,
            job_run_id=job_run_id,
            current_node=current_node,
            summary=summary,
            approval_status=approval_status,
            created_at=datetime.now(UTC),
        )
        self._records.append(record)
        return record

    def record_model_run(
        self,
        *,
        thread_id: str,
        job_run_id: str,
        provider_name: str,
        model_name: str,
        capability: str,
        latency_ms: int,
        token_usage: int,
        input_summary: str,
        output_summary: str,
        status: str = "completed",
        error_message: str | None = None,
    ) -> RuntimeModelRunRecord:
        model_run = RuntimeModelRunRecord(
            model_run_id=len(self._model_runs) + 1,
            thread_id=thread_id,
            job_run_id=job_run_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            latency_ms=latency_ms,
            token_usage=token_usage,
            input_summary=input_summary,
            output_summary=output_summary,
            status=status,
            error_message=error_message,
            created_at=datetime.now(UTC),
        )
        self._model_runs.append(model_run)
        return model_run

    def save_state(self, thread_id: str, state: dict[str, Any]) -> None:
        reference_state = checkpoint_reference_state(state)
        self._state[thread_id] = reference_state

    def list_state_snapshots(self, thread_id: str) -> list[RuntimeStateSnapshot]:
        stored = self._state.get(thread_id)
        if stored is None:
            return []
        return [snapshot_from_state(stored)]

    def list_incomplete_workflows(self) -> list[RuntimeStateSnapshot]:
        return [
            snapshot_from_state(state)
            for state in self._state.values()
            if state.get("approval_status", "pending") != "approved"
        ]

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

    def list_model_runs(self, thread_id: str) -> list[RuntimeModelRunRecord]:
        return [record for record in self._model_runs if record.thread_id == thread_id]
