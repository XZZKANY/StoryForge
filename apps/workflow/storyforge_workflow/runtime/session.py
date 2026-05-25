from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from time import time


@dataclass(frozen=True)
class SessionPromptEntry:
    """记录一次 provider prompt 摘要，避免会话历史保存完整大文本。"""

    node_name: str
    prompt_summary: str
    model_name: str | None
    created_at_ms: int


@dataclass(frozen=True)
class SessionCompaction:
    """描述会话历史压缩结果，后续可映射到持久化摘要。"""

    summary: str
    source_prompt_count: int
    created_at_ms: int


@dataclass(frozen=True)
class WorkflowSession:
    """Workflow 长会话快照，第一阶段仅由内存仓库维护。"""

    session_id: str
    thread_id: str
    job_run_id: str
    workspace_id: int | None
    created_at_ms: int
    updated_at_ms: int
    status: str
    current_node: str
    model_name: str | None
    prompt_history: list[SessionPromptEntry]
    compaction: SessionCompaction | None
    last_heartbeat_ms: int | None


class InMemoryWorkflowSessionStore:
    """进程内会话仓库，用于固定第一阶段接口与本地测试。"""

    def __init__(self, *, clock_ms: Callable[[], int] | None = None) -> None:
        self._clock_ms = clock_ms or _now_ms
        self._sessions: dict[str, WorkflowSession] = {}

    def create(
        self,
        *,
        session_id: str,
        thread_id: str,
        job_run_id: str,
        workspace_id: int | None = None,
        status: str = "queued",
        current_node: str = "runtime_start",
        model_name: str | None = None,
    ) -> WorkflowSession:
        created_at_ms = self._clock_ms()
        session = WorkflowSession(
            session_id=session_id,
            thread_id=thread_id,
            job_run_id=job_run_id,
            workspace_id=workspace_id,
            created_at_ms=created_at_ms,
            updated_at_ms=created_at_ms,
            status=status,
            current_node=current_node,
            model_name=model_name,
            prompt_history=[],
            compaction=None,
            last_heartbeat_ms=None,
        )
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> WorkflowSession | None:
        """按会话 ID 返回最新快照。"""

        return self._sessions.get(session_id)

    def latest_for_thread(self, thread_id: str) -> WorkflowSession | None:
        """返回指定 thread_id 最近写入的会话。"""

        for session in reversed(list(self._sessions.values())):
            if session.thread_id == thread_id:
                return session
        return None

    def update_status(self, session_id: str, *, status: str, current_node: str) -> WorkflowSession:
        """更新状态和当前节点，保留其他会话字段。"""

        session = self._require(session_id)
        updated = replace(
            session,
            status=status,
            current_node=current_node,
            updated_at_ms=self._clock_ms(),
        )
        self._sessions[session_id] = updated
        return updated

    def append_prompt(
        self,
        session_id: str,
        *,
        node_name: str,
        prompt_summary: str,
        model_name: str | None,
    ) -> WorkflowSession:
        """追加 prompt 摘要并同步最近模型名称。"""

        session = self._require(session_id)
        created_at_ms = self._clock_ms()
        entry = SessionPromptEntry(
            node_name=node_name,
            prompt_summary=prompt_summary,
            model_name=model_name,
            created_at_ms=created_at_ms,
        )
        updated = replace(
            session,
            model_name=model_name,
            prompt_history=[*session.prompt_history, entry],
            updated_at_ms=created_at_ms,
        )
        self._sessions[session_id] = updated
        return updated

    def heartbeat(self, session_id: str) -> WorkflowSession:
        """刷新会话存活时间，供后续恢复和监控读取。"""

        session = self._require(session_id)
        heartbeat_ms = self._clock_ms()
        updated = replace(
            session,
            updated_at_ms=heartbeat_ms,
            last_heartbeat_ms=heartbeat_ms,
        )
        self._sessions[session_id] = updated
        return updated

    def _require(self, session_id: str) -> WorkflowSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(f"未知 workflow session：{session_id}")
        return session


def _now_ms() -> int:
    return int(time() * 1000)
