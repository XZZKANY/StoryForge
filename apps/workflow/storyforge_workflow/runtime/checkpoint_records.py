from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


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


def format_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def record_from_row(row: Mapping[str, Any]) -> RuntimeRecord:
    return RuntimeRecord(
        thread_id=str(row["thread_id"]),
        job_run_id=str(row["job_run_id"]),
        current_node=str(row["current_node"]),
        summary=str(row["summary"]),
        approval_status=str(row["approval_status"]),
        created_at=parse_datetime(str(row["created_at"])),
    )


def model_run_from_row(row: Mapping[str, Any]) -> RuntimeModelRunRecord:
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
        created_at=parse_datetime(str(row["created_at"])),
    )


def state_snapshot_from_row(row: Mapping[str, Any]) -> RuntimeStateSnapshot:
    state = json.loads(str(row["state_json"]))
    return RuntimeStateSnapshot(
        thread_id=str(row["thread_id"]),
        job_run_id=str(row["job_run_id"]),
        current_node=str(row["current_node"]),
        approval_status=str(row["approval_status"]),
        state=dict(state),
        updated_at=parse_datetime(str(row["updated_at"])),
    )


def snapshot_from_latest_state_row(row: Mapping[str, Any]) -> RuntimeStateSnapshot:
    state = json.loads(str(row["state_json"]))
    return snapshot_from_state(dict(state), updated_at=parse_datetime(str(row["updated_at"])))


def snapshot_from_state(state: dict[str, Any], *, updated_at: datetime | None = None) -> RuntimeStateSnapshot:
    return RuntimeStateSnapshot(
        thread_id=str(state.get("thread_id", "")),
        job_run_id=str(state.get("job_run_id", "")),
        current_node=str(state.get("current_node", "unknown")),
        approval_status=str(state.get("approval_status", "pending")),
        state=dict(state),
        updated_at=updated_at or datetime.now(UTC),
    )
