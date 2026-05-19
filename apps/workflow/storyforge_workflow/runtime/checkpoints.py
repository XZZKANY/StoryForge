from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from storyforge_workflow.state import checkpoint_reference_state


@dataclass(frozen=True)
class RuntimeRecord:
    thread_id: str
    job_run_id: str
    current_node: str
    summary: str
    approval_status: str
    created_at: datetime


@dataclass(frozen=True)
class RuntimeModelRunRecord:
    """workflow 运行时的轻量模型调用记录，可替换为 API ModelRun 落库实现。"""

    model_run_id: int
    thread_id: str
    job_run_id: str
    provider_name: str
    model_name: str
    capability: str
    latency_ms: int
    token_usage: int
    input_summary: str
    output_summary: str
    status: str
    error_message: str | None
    created_at: datetime


@dataclass(frozen=True)
class ModelRunPayload:
    """投递给外部 ModelRun 持久化 adapter 的最小字段集合。"""

    thread_id: str
    job_run_id: str
    provider_name: str
    model_name: str
    capability: str
    latency_ms: int
    token_usage: int
    input_summary: str
    output_summary: str
    status: str
    error_message: str | None

    def to_api_payload(self, *, api_job_run_id: int) -> dict[str, object]:
        """转换为 API ModelRunCreate 兼容字段，显式使用 API 真表的 int 任务 ID。"""

        if api_job_run_id <= 0:
            raise ValueError("API ModelRun 的 job_run_id 必须是已持久化 JobRun 的正整数 ID。")
        return {
            "job_run_id": api_job_run_id,
            "provider_name": self.provider_name,
            "model_name": self.model_name,
            "capability": self.capability,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "token_usage": self.token_usage,
            "input_summary": self.input_summary,
            "output_summary": self.output_summary,
            "error_message": self.error_message,
            "payload": {"thread_id": self.thread_id, "runtime_job_run_id": self.job_run_id},
        }


class ModelRunSink(Protocol):
    """workflow 到 API ModelRun 真表 adapter 的可替换边界。"""

    def record(self, payload: ModelRunPayload) -> None:
        """接收模型运行摘要；实现方决定是否写 API、数据库或测试捕获器。"""


class RuntimeCheckpointStore:
    """持久化运行时的最小内存实现，可被真实数据库实现替换。"""

    def __init__(self) -> None:
        self._records: list[RuntimeRecord] = []
        self._model_runs: list[RuntimeModelRunRecord] = []
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
            created_at=datetime.now(timezone.utc),
        )
        self._model_runs.append(model_run)
        return model_run

    def save_state(self, thread_id: str, state: dict[str, Any]) -> None:
        self._state[thread_id] = checkpoint_reference_state(state)

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
