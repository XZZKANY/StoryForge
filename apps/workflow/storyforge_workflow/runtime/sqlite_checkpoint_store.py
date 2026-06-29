from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager, suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from storyforge_workflow.runtime.checkpoint_records import (
    RuntimeModelRunRecord,
    RuntimeRecord,
    RuntimeStateSnapshot,
    format_datetime,
    model_run_from_row,
    record_from_row,
    snapshot_from_latest_state_row,
    state_snapshot_from_row,
)
from storyforge_workflow.state import checkpoint_reference_state


class RuntimeCheckpointStore:
    """使用 SQLite 持久化运行时 checkpoint，默认避免进程退出后丢状态。"""

    def __init__(self, *, sqlite_path: str | os.PathLike[str] | None = None) -> None:
        self.sqlite_path = Path(sqlite_path) if sqlite_path is not None else default_sqlite_path()
        self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection: sqlite3.Connection | None = None
        self._connection_lock = threading.RLock()
        self._write_behind_enabled = truthy_env("STORYFORGE_CHECKPOINT_WRITE_BEHIND")
        self._write_behind_interval = float_env("STORYFORGE_CHECKPOINT_WRITE_BEHIND_FLUSH_INTERVAL_SECONDS", 1.0)
        self._pending_states: dict[str, tuple[dict[str, Any], str, str]] = {}
        self._write_behind_condition = threading.Condition(self._connection_lock)
        self._write_behind_closed = False
        self._write_behind_thread: threading.Thread | None = None
        self._setup()
        if self._write_behind_enabled:
            self._write_behind_thread = threading.Thread(
                target=self._write_behind_loop,
                name="storyforge-checkpoint-writer",
                daemon=True,
            )
            self._write_behind_thread.start()

    def close(self) -> None:
        """关闭当前 store 持有的 SQLite 连接，供 worker 退出和测试清理使用。"""

        self.flush()
        with self._write_behind_condition:
            self._write_behind_closed = True
            self._write_behind_condition.notify_all()
        if self._write_behind_thread is not None:
            self._write_behind_thread.join(timeout=2)
        with self._connection_lock:
            connection = self._connection
            self._connection = None
        if connection is not None:
            connection.close()

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
                    format_datetime(record.created_at),
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
                    format_datetime(created_at),
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
        updated_at = format_datetime(datetime.now(UTC))
        if self._write_behind_enabled:
            with self._write_behind_condition:
                self._pending_states[thread_id] = (reference_state, state_json, updated_at)
                self._write_behind_condition.notify_all()
            return
        self._write_state(
            thread_id=thread_id,
            reference_state=reference_state,
            state_json=state_json,
            updated_at=updated_at,
        )

    def flush(self) -> None:
        """把 write-behind 缓冲中的最新 checkpoint 刷入 SQLite。"""

        with self._connection_lock:
            pending = self._drain_pending_states_locked()
            for thread_id, (reference_state, state_json, updated_at) in pending.items():
                self._write_state(
                    thread_id=thread_id,
                    reference_state=reference_state,
                    state_json=state_json,
                    updated_at=updated_at,
                )

    def _write_state(
        self,
        *,
        thread_id: str,
        reference_state: dict[str, Any],
        state_json: str,
        updated_at: str,
    ) -> None:
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
        self.flush()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT state_json FROM runtime_states WHERE thread_id = ?", (thread_id,)
            ).fetchone()
        if row is None:
            return None
        state = json.loads(str(row["state_json"]))
        return dict(state)

    def latest(self, thread_id: str) -> RuntimeRecord | None:
        self.flush()
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
        return None if row is None else record_from_row(row)

    def list_records(self, thread_id: str) -> list[RuntimeRecord]:
        self.flush()
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
        return [record_from_row(row) for row in rows]

    def list_model_runs(self, thread_id: str) -> list[RuntimeModelRunRecord]:
        self.flush()
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
        return [model_run_from_row(row) for row in rows]

    def list_state_snapshots(self, thread_id: str) -> list[RuntimeStateSnapshot]:
        """按写入顺序返回指定线程的状态快照历史。"""

        self.flush()
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
        return [state_snapshot_from_row(row) for row in rows]

    def list_incomplete_workflows(self) -> list[RuntimeStateSnapshot]:
        """返回启动时可恢复的未完成 workflow 最新 checkpoint。"""

        self.flush()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT thread_id, state_json, updated_at
                FROM runtime_states
                ORDER BY updated_at, thread_id
                """
            ).fetchall()
        snapshots = [snapshot_from_latest_state_row(row) for row in rows]
        return [snapshot for snapshot in snapshots if snapshot.approval_status != "approved"]

    @contextmanager
    def _connect(self):
        with self._connection_lock:
            if self._connection is None:
                self._connection = sqlite3.connect(self.sqlite_path, check_same_thread=False)
                self._connection.row_factory = sqlite3.Row
                configure_sqlite_connection(self._connection)
            connection = self._connection
            try:
                with connection:
                    yield connection
            except sqlite3.Error:
                if self._connection is connection:
                    self._connection = None
                with suppress(sqlite3.Error):
                    connection.close()
                raise

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

    def _write_behind_loop(self) -> None:
        while True:
            with self._write_behind_condition:
                if not self._pending_states and not self._write_behind_closed:
                    self._write_behind_condition.wait(timeout=max(0.1, self._write_behind_interval))
                if self._write_behind_closed:
                    return
                if not self._pending_states:
                    continue
                self._write_behind_condition.wait(timeout=max(0.1, self._write_behind_interval))
                if self._write_behind_closed:
                    return
            self.flush()

    def _drain_pending_states_locked(self) -> dict[str, tuple[dict[str, Any], str, str]]:
        pending = dict(self._pending_states)
        self._pending_states.clear()
        return pending


def default_sqlite_path() -> Path:
    configured = os.getenv("STORYFORGE_WORKFLOW_SQLITE_PATH")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / ".runtime" / "workflow-runtime.sqlite3"


def configure_sqlite_connection(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=5000")


def truthy_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = float(raw)
    except ValueError:
        return default
    return parsed if parsed > 0 else default
