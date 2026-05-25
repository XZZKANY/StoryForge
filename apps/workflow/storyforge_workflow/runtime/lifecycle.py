from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from time import time


class WorkflowLifecycleStatus(StrEnum):
    """Workflow 运行生命周期状态，值直接用于 API/Web 展示。"""

    QUEUED = "queued"
    PROVIDER_RUNNING = "provider_running"
    GRAPH_RUNNING = "graph_running"
    APPROVAL_WAITING = "approval_waiting"
    RESUMING = "resuming"
    COMPLETED = "completed"
    RECOVERABLE_FAILED = "recoverable_failed"
    TERMINAL_FAILED = "terminal_failed"


class WorkflowFailureKind(StrEnum):
    """运行失败分类，便于后续恢复策略按机器字段判断。"""

    PROVIDER_TIMEOUT = "provider_timeout"
    PROVIDER_INVALID_RESPONSE = "provider_invalid_response"
    CHECKPOINT_SAVE_FAILED = "checkpoint_save_failed"
    APPROVAL_PAYLOAD_INVALID = "approval_payload_invalid"
    RESUME_THREAD_MISMATCH = "resume_thread_mismatch"
    TOOL_CONTRACT_FAILED = "tool_contract_failed"
    UNKNOWN_RUNTIME_ERROR = "unknown_runtime_error"


@dataclass(frozen=True)
class WorkflowLifecycleEvent:
    """单条运行生命周期事件。"""

    thread_id: str
    job_run_id: str
    status: str
    current_node: str
    message: str
    failure_kind: str | None
    recoverable: bool | None
    created_at_ms: int


class InMemoryWorkflowLifecycleStore:
    """进程内 lifecycle 事件仓库，用于第一阶段固定事件协议。"""

    def __init__(self, *, clock_ms: Callable[[], int] | None = None) -> None:
        self._clock_ms = clock_ms or _now_ms
        self._events: list[WorkflowLifecycleEvent] = []

    def record(
        self,
        *,
        thread_id: str,
        job_run_id: str,
        status: WorkflowLifecycleStatus | str,
        current_node: str,
        message: str,
        failure_kind: WorkflowFailureKind | str | None = None,
        recoverable: bool | None = None,
    ) -> WorkflowLifecycleEvent:
        """追加一条 lifecycle 事件并返回不可变快照。"""

        event = WorkflowLifecycleEvent(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=str(status),
            current_node=current_node,
            message=message,
            failure_kind=None if failure_kind is None else str(failure_kind),
            recoverable=recoverable,
            created_at_ms=self._clock_ms(),
        )
        self._events.append(event)
        return event

    def record_failure(
        self,
        *,
        thread_id: str,
        job_run_id: str,
        current_node: str,
        message: str,
        failure_kind: WorkflowFailureKind | str,
        recoverable: bool,
    ) -> WorkflowLifecycleEvent:
        """按 recoverable 标记记录可恢复或终止失败。"""

        status = WorkflowLifecycleStatus.RECOVERABLE_FAILED if recoverable else WorkflowLifecycleStatus.TERMINAL_FAILED
        return self.record(
            thread_id=thread_id,
            job_run_id=job_run_id,
            status=status,
            current_node=current_node,
            message=message,
            failure_kind=failure_kind,
            recoverable=recoverable,
        )

    def list_events(self, thread_id: str) -> list[WorkflowLifecycleEvent]:
        """按写入顺序返回指定线程的 lifecycle 事件。"""

        return [event for event in self._events if event.thread_id == thread_id]

    def latest(self, thread_id: str) -> WorkflowLifecycleEvent | None:
        """返回指定线程最新 lifecycle 事件。"""

        for event in reversed(self._events):
            if event.thread_id == thread_id:
                return event
        return None


def _now_ms() -> int:
    return int(time() * 1000)
