from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.common.exceptions import NotFoundError
from app.domains.agent_runs.models import AgentRun, AgentRunEvent

AGENT_RUN_TERMINAL_STATUSES = frozenset({"completed", "failed", "stopped"})
# 起服收尸只应清理「本有活线程、进程重启后线程已消失」的 running。paused 是等待作者确认
# 补丁 / 用户暂停的持久可恢复态：其不需要线程，靠后续控制消息（approve/deny/resume）推进。
# 若把 paused 也收成 failed，approve 门（仅在 status==paused 时放行）会永久失效。
AGENT_RUN_REAP_PRESERVED_STATUSES = AGENT_RUN_TERMINAL_STATUSES | {"paused"}


class AgentRunNotFoundError(NotFoundError):
    """AgentRun 不存在。"""


class AgentRuntimeError(RuntimeError):
    """Agent Runtime 包装下游编排失败。"""


class AgentRuntimeUserMessageError(AgentRuntimeError):
    """user_message facade 失败，但已创建 AgentRun，可用于实时错误帧回传 run_id。"""

    def __init__(self, detail: str, *, run: AgentRun, started_event: AgentRunEvent) -> None:
        super().__init__(detail)
        self.run = run
        self.started_event = started_event


@dataclass(frozen=True)
class AgentRunStartResult:
    run: AgentRun
    started_event: AgentRunEvent


@dataclass(frozen=True)
class AgentRuntimeUserMessageResult:
    run: AgentRun
    started_event: AgentRunEvent
    result: dict[str, Any]


@dataclass(frozen=True)
class AgentControlResult:
    event: AgentRunEvent
    resumed_result: dict[str, Any] | None = None
    resume_diagnostic: dict[str, Any] | None = None
