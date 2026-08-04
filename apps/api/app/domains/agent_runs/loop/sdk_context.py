from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs.loop.types import ChatLoopOutcome
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.permission import PermissionGate
from app.domains.agent_runs.tools import ToolDefinition, ToolResult
from app.domains.agent_runs.trace import AgentToolTrace
from app.platform.ai_sdk import ChatResponse, RuntimeCheckpoint, ToolCall

ExecuteStoryForgeTool = Callable[[str, dict[str, Any]], ToolResult]
TraceCallback = Callable[[AgentToolTrace], None]
InterruptionCallback = Callable[[str], dict[str, Any] | None]


@dataclass
class StoryForgeRuntimeContext:
    session: Session
    assistant_session_id: int
    run: AgentRun
    source: Mapping[str, str | None]
    permission_gate: PermissionGate
    definitions: Mapping[str, ToolDefinition]
    execute_tool: ExecuteStoryForgeTool
    on_trace: TraceCallback
    outcome: ChatLoopOutcome
    should_interrupt: InterruptionCallback | None = None
    provider_attempts: int = 0
    completed_model_rounds: int = 0
    interruption: dict[str, Any] | None = None
    latest_checkpoint: RuntimeCheckpoint | None = None
    handled_call_ids: set[str] = field(default_factory=set)
    calls_by_id: dict[str, ToolCall] = field(default_factory=dict)
    allowed_call_ids: dict[str, deque[str]] = field(
        default_factory=lambda: defaultdict(deque)
    )
    pending_costs: deque[tuple[float, object]] = field(default_factory=deque)

    def remember_response(self, response: ChatResponse) -> ChatResponse:
        normalized_calls: list[ToolCall] = []
        for call in response.tool_calls:
            call_id = call.id or f"call_{self.outcome.tool_call_count}"
            while call_id in self.calls_by_id:
                call_id = f"{call_id}_{self.outcome.tool_call_count}"
            normalized = replace(call, id=call_id)
            normalized_calls.append(normalized)
            self.calls_by_id[call_id] = normalized
            self.outcome.tool_call_count += 1
        self.completed_model_rounds += 1
        return replace(response, tool_calls=tuple(normalized_calls))

    def allow_call(self, llm_name: str, call_id: str) -> None:
        self.allowed_call_ids[llm_name].append(call_id)

    def claim_allowed_call(self, llm_name: str) -> ToolCall | None:
        call_ids = self.allowed_call_ids.get(llm_name)
        if not call_ids:
            return None
        return self.calls_by_id.get(call_ids.popleft())

    def record_trace(self, trace: AgentToolTrace, *, call_id: str | None = None) -> None:
        self.outcome.traces.append(trace)
        self.on_trace(trace)
        if call_id:
            self.handled_call_ids.add(call_id)
