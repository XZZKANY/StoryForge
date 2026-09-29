"""One cooperative control/deadline owner for every path of an Agent invocation."""
from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from app.common.llm_control import LLMRunControl, llm_run_control
from app.domains.agent_runs.loop.types import ChatLoopOutcome

if TYPE_CHECKING:
    from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext

RUN_MAX_DURATION_SECONDS = 900.0
InterruptionCallback = Callable[[str], dict[str, Any] | None]


class InterruptionOwner(Protocol):
    should_interrupt: InterruptionCallback | None
    interruption: dict[str, Any] | None


def build_run_control(context: InterruptionOwner, *, duration_seconds: float) -> LLMRunControl:
    if duration_seconds <= 0:
        raise ValueError("Run duration budget must be positive")

    def check(boundary: str) -> str | None:
        if context.interruption is None and context.should_interrupt is not None:
            context.interruption = context.should_interrupt(boundary)
        if context.interruption is not None:
            return str(context.interruption.get("status") or "interrupted")
        return None

    return LLMRunControl(check, deadline=time.monotonic() + duration_seconds)


@dataclass
class AgentRunControlScope:
    should_interrupt: InterruptionCallback | None
    interruption: dict[str, Any] | None = None
    control: LLMRunControl = field(init=False)


_active_scope: ContextVar[AgentRunControlScope | None] = ContextVar("agent_run_control_scope", default=None)


def current_run_control() -> AgentRunControlScope | None:
    return _active_scope.get()


@contextmanager
def agent_run_control_scope(
    check: InterruptionCallback, *, on_progress: Callable[[dict[str, object]], None] | None = None,
) -> Iterator[AgentRunControlScope]:
    owner = AgentRunControlScope(check)
    owner.control = build_run_control(owner, duration_seconds=RUN_MAX_DURATION_SECONDS)
    owner.control.on_progress = on_progress
    token = _active_scope.set(owner)
    try:
        with llm_run_control(owner.control):
            yield owner
    finally:
        _active_scope.reset(token)


def control_interruption() -> dict[str, Any]:
    owner = current_run_control()
    if owner is None or owner.interruption is None:
        raise RuntimeError("Interrupted run is missing its control fact")
    return owner.interruption


def finish_interrupted_run(context: StoryForgeRuntimeContext, reason: str) -> ChatLoopOutcome:
    outcome = context.outcome
    outcome.rounds = context.provider_attempts
    if reason == "deadline_exceeded":
        outcome.mark_failed("runtime_deadline", "本轮执行时间预算已用完，未继续派发模型或工具。")
        outcome.exhausted = True
    else:
        if context.interruption is None:
            context.interruption = control_interruption()
        outcome.interrupted = True
        outcome.interruption = context.interruption
        outcome.answer = outcome.answer or "已按你的操作停下，这轮没有继续。"
    return outcome
