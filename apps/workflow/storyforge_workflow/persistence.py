from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
import json


@dataclass(frozen=True)
class WorkflowCheckpoint:
    """面向审计的工作流检查点记录。"""

    thread_id: str
    job_run_id: str
    current_node: str
    input_summary: str
    output_summary: str
    approval_status: str
    created_at: datetime


class InMemoryWorkflowStore:
    """本地内存审计仓库，便于测试替换为持久化实现。"""

    def __init__(self) -> None:
        self._records: list[WorkflowCheckpoint] = []

    def record(
        self,
        *,
        thread_id: str,
        job_run_id: str,
        current_node: str,
        input_summary: str,
        output_summary: str,
        approval_status: str,
    ) -> WorkflowCheckpoint:
        checkpoint = WorkflowCheckpoint(
            thread_id=thread_id,
            job_run_id=job_run_id,
            current_node=current_node,
            input_summary=input_summary,
            output_summary=output_summary,
            approval_status=approval_status,
            created_at=datetime.now(UTC),
        )
        self._records.append(checkpoint)
        return checkpoint

    def list_records(self, *, thread_id: str | None = None) -> list[WorkflowCheckpoint]:
        """按写入顺序返回检查点，支持按 thread_id 过滤。"""

        if thread_id is None:
            return list(self._records)
        return [record for record in self._records if record.thread_id == thread_id]

    def latest_for(self, thread_id: str) -> WorkflowCheckpoint | None:
        """返回指定线程的最新检查点。"""

        for record in reversed(self._records):
            if record.thread_id == thread_id:
                return record
        return None


def summarize_value(value: Any, *, limit: int = 240) -> str:
    """生成稳定摘要，避免检查点保存完整大对象。"""

    try:
        summary = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    except TypeError:
        summary = str(value)
    if len(summary) <= limit:
        return summary
    return f"{summary[:limit - 1]}…"
