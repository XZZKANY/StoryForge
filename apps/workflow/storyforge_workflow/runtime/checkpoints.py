from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
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
class RuntimeStateSnapshot:
    """SQLite 中保存的单次 workflow 状态快照。"""

    thread_id: str
    job_run_id: str
    current_node: str
    approval_status: str
    state: dict[str, Any]
    updated_at: datetime


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
    extras: dict[str, object] | None = None

    def to_api_payload(self, *, api_job_run_id: int) -> dict[str, object]:
        """转换为 API ModelRunCreate 兼容字段，显式使用 API 真表的 int 任务 ID。"""

        validated_job_run_id = _validate_api_job_run_id(api_job_run_id)
        payload_metadata: dict[str, object] = {
            "thread_id": self.thread_id,
            "runtime_job_run_id": self.job_run_id,
        }
        if self.extras:
            payload_metadata.update(self.extras)
        return {
            "job_run_id": validated_job_run_id,
            "provider_name": self.provider_name,
            "model_name": self.model_name,
            "capability": self.capability,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "token_usage": self.token_usage,
            "input_summary": self.input_summary,
            "output_summary": self.output_summary,
            "error_message": self.error_message,
            "payload": payload_metadata,
        }


class ModelRunSink(Protocol):
    """workflow 到 API ModelRun 真表 adapter 的可替换边界。"""

    def record(self, payload: ModelRunPayload) -> int | None:
        """接收模型运行摘要；返回值为已持久化 API ModelRun ID。"""


class ApiModelRunAdapter:
    """把 workflow payload 交给 API 真表写入函数的最小 adapter。"""

    def __init__(self, *, api_job_run_id: int, record_api_model_run: Callable[[dict[str, object]], int]) -> None:
        self.api_job_run_id = _validate_api_job_run_id(api_job_run_id)
        self.record_api_model_run = record_api_model_run

    def record(self, payload: ModelRunPayload) -> int:
        api_payload = payload.to_api_payload(api_job_run_id=self.api_job_run_id)
        return self.record_api_model_run(api_payload)


def _validate_api_job_run_id(api_job_run_id: object) -> int:
    """确认传入的是 API JobRun 真表的正整数主键，而不是 workflow 字符串 ID。"""

    if type(api_job_run_id) is not int or api_job_run_id <= 0:
        raise ValueError("API ModelRun 的 job_run_id 必须是已持久化 JobRun 的正整数 ID。")
    return api_job_run_id


class InMemoryRuntimeCheckpointStore:
    """显式测试替身：只在调用方主动选择时使用进程内存保存运行时记录。"""

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
        return [_snapshot_from_state(stored)]

    def list_incomplete_workflows(self) -> list[RuntimeStateSnapshot]:
        return [
            _snapshot_from_state(state)
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


class RuntimeCheckpointStore:
    """使用 SQLite 持久化运行时 checkpoint，默认避免进程退出后丢状态。"""

    def __init__(self, *, sqlite_path: str | os.PathLike[str] | None = None) -> None:
        self.sqlite_path = Path(sqlite_path) if sqlite_path is not None else _default_sqlite_path()
        self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self._setup()

    def record(self, *, thread_id: str, job_run_id: str, current_node: str, summary: str, approval_status: str) -> RuntimeRecord:
        record = RuntimeRecord(
            thread_id=thread_id,
            job_run_id=job_run_id,
            current_node=current_node,
            summary=summary,
            approval_status=approval_status,
            created_at=datetime.now(UTC),
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO runtime_records (thread_id, job_run_id, current_node, summary, approval_status, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    record.thread_id,
                    record.job_run_id,
                    record.current_node,
                    record.summary,
                    record.approval_status,
                    _format_datetime(record.created_at),
                ),
            )
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
        created_at = datetime.now(UTC)
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO runtime_model_runs (
                    thread_id, job_run_id, provider_name, model_name, capability, latency_ms,
                    token_usage, input_summary, output_summary, status, error_message, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    thread_id,
                    job_run_id,
                    provider_name,
                    model_name,
                    capability,
                    latency_ms,
                    token_usage,
                    input_summary,
                    output_summary,
                    status,
                    error_message,
                    _format_datetime(created_at),
                ),
            )
            model_run_id = int(cursor.lastrowid)
        return RuntimeModelRunRecord(
            model_run_id=model_run_id,
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
            created_at=created_at,
        )

    def save_state(self, thread_id: str, state: dict[str, Any]) -> None:
        reference_state = checkpoint_reference_state(state)
        state_json = json.dumps(reference_state, ensure_ascii=False, sort_keys=True, default=str)
        updated_at = _format_datetime(datetime.now(UTC))
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO runtime_states (thread_id, state_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
                """,
                (
                    thread_id,
                    state_json,
                    updated_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO runtime_state_snapshots (
                    thread_id, job_run_id, current_node, approval_status, state_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    thread_id,
                    str(reference_state.get("job_run_id", "")),
                    str(reference_state.get("current_node", "unknown")),
                    str(reference_state.get("approval_status", "pending")),
                    state_json,
                    updated_at,
                ),
            )

    def load_state(self, thread_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT state_json FROM runtime_states WHERE thread_id = ?", (thread_id,)).fetchone()
        if row is None:
            return None
        state = json.loads(str(row["state_json"]))
        return dict(state)

    def latest(self, thread_id: str) -> RuntimeRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT thread_id, job_run_id, current_node, summary, approval_status, created_at
                FROM runtime_records
                WHERE thread_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (thread_id,),
            ).fetchone()
        return None if row is None else _record_from_row(row)

    def list_records(self, thread_id: str) -> list[RuntimeRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT thread_id, job_run_id, current_node, summary, approval_status, created_at
                FROM runtime_records
                WHERE thread_id = ?
                ORDER BY id
                """,
                (thread_id,),
            ).fetchall()
        return [_record_from_row(row) for row in rows]

    def list_model_runs(self, thread_id: str) -> list[RuntimeModelRunRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, thread_id, job_run_id, provider_name, model_name, capability, latency_ms,
                       token_usage, input_summary, output_summary, status, error_message, created_at
                FROM runtime_model_runs
                WHERE thread_id = ?
                ORDER BY id
                """,
                (thread_id,),
            ).fetchall()
        return [_model_run_from_row(row) for row in rows]

    def list_state_snapshots(self, thread_id: str) -> list[RuntimeStateSnapshot]:
        """按写入顺序返回指定线程的状态快照历史。"""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT thread_id, job_run_id, current_node, approval_status, state_json, updated_at
                FROM runtime_state_snapshots
                WHERE thread_id = ?
                ORDER BY id
                """,
                (thread_id,),
            ).fetchall()
        return [_state_snapshot_from_row(row) for row in rows]

    def list_incomplete_workflows(self) -> list[RuntimeStateSnapshot]:
        """返回启动时可恢复的未完成 workflow 最新 checkpoint。"""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT thread_id, state_json, updated_at
                FROM runtime_states
                ORDER BY updated_at, thread_id
                """
            ).fetchall()
        snapshots = [_snapshot_from_latest_state_row(row) for row in rows]
        return [snapshot for snapshot in snapshots if snapshot.approval_status != "approved"]

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.sqlite_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _setup(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS runtime_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT NOT NULL,
                    job_run_id TEXT NOT NULL,
                    current_node TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    approval_status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_records_thread_id ON runtime_records(thread_id, id);
                CREATE TABLE IF NOT EXISTS runtime_model_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT NOT NULL,
                    job_run_id TEXT NOT NULL,
                    provider_name TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    capability TEXT NOT NULL,
                    latency_ms INTEGER NOT NULL,
                    token_usage INTEGER NOT NULL,
                    input_summary TEXT NOT NULL,
                    output_summary TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error_message TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_model_runs_thread_id ON runtime_model_runs(thread_id, id);
                CREATE TABLE IF NOT EXISTS runtime_states (
                    thread_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_state_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT NOT NULL,
                    job_run_id TEXT NOT NULL,
                    current_node TEXT NOT NULL,
                    approval_status TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_state_snapshots_thread_id ON runtime_state_snapshots(thread_id, id);
                """
            )


def _default_sqlite_path() -> Path:
    configured = os.getenv("STORYFORGE_WORKFLOW_SQLITE_PATH")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / ".runtime" / "workflow-runtime.sqlite3"


def _format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _record_from_row(row: sqlite3.Row) -> RuntimeRecord:
    return RuntimeRecord(
        thread_id=str(row["thread_id"]),
        job_run_id=str(row["job_run_id"]),
        current_node=str(row["current_node"]),
        summary=str(row["summary"]),
        approval_status=str(row["approval_status"]),
        created_at=_parse_datetime(str(row["created_at"])),
    )


def _model_run_from_row(row: sqlite3.Row) -> RuntimeModelRunRecord:
    return RuntimeModelRunRecord(
        model_run_id=int(row["id"]),
        thread_id=str(row["thread_id"]),
        job_run_id=str(row["job_run_id"]),
        provider_name=str(row["provider_name"]),
        model_name=str(row["model_name"]),
        capability=str(row["capability"]),
        latency_ms=int(row["latency_ms"]),
        token_usage=int(row["token_usage"]),
        input_summary=str(row["input_summary"]),
        output_summary=str(row["output_summary"]),
        status=str(row["status"]),
        error_message=None if row["error_message"] is None else str(row["error_message"]),
        created_at=_parse_datetime(str(row["created_at"])),
    )


def _state_snapshot_from_row(row: sqlite3.Row) -> RuntimeStateSnapshot:
    state = json.loads(str(row["state_json"]))
    return RuntimeStateSnapshot(
        thread_id=str(row["thread_id"]),
        job_run_id=str(row["job_run_id"]),
        current_node=str(row["current_node"]),
        approval_status=str(row["approval_status"]),
        state=dict(state),
        updated_at=_parse_datetime(str(row["updated_at"])),
    )


def _snapshot_from_latest_state_row(row: sqlite3.Row) -> RuntimeStateSnapshot:
    state = json.loads(str(row["state_json"]))
    return _snapshot_from_state(dict(state), updated_at=_parse_datetime(str(row["updated_at"])))


def _snapshot_from_state(state: dict[str, Any], *, updated_at: datetime | None = None) -> RuntimeStateSnapshot:
    return RuntimeStateSnapshot(
        thread_id=str(state.get("thread_id", "")),
        job_run_id=str(state.get("job_run_id", "")),
        current_node=str(state.get("current_node", "unknown")),
        approval_status=str(state.get("approval_status", "pending")),
        state=dict(state),
        updated_at=updated_at or datetime.now(UTC),
    )
