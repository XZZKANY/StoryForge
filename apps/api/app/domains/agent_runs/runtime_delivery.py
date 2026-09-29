"""Delivery gate after known work, before committing a successful conversation turn."""
from __future__ import annotations

from typing import Any

from app.common.llm_control import LLMRunInterrupted, check_run_interruption
from app.domains.agent_runs.events.runtime_support import runtime_interrupted_response
from app.domains.agent_runs.loop.run_control import control_interruption
from app.domains.agent_runs.result_contracts import AgentExecutionOutcome


def interrupted_delivery_result(
    result: dict[str, Any], reason: str, *, events_recorded: bool = False,
) -> dict[str, Any]:
    agent_result = result["agent_result"]
    result["proposed_patch"] = None
    result.pop("_tool_artifacts", None)
    agent_result["requires_user_confirmation"] = False
    agent_result["writeback_blocked_until_user_confirms"] = False
    for key in ("confirmation_action", "confirmation_kind", "blocked_tool"):
        agent_result.pop(key, None)
    if reason != "deadline_exceeded":
        return runtime_interrupted_response(result, control_interruption(), events_recorded=events_recorded)
    outcome = AgentExecutionOutcome(
        status="partial" if result.get("tool_trace") else "failed", code="runtime_deadline",
        message="本轮执行时间预算已用完，未继续派发模型或工具。",
    )
    agent_result.update(summary=outcome.message, execution_outcome=outcome.model_dump())
    for step in result.get("plan", []):
        if step["status"] != "completed":
            step["status"] = "failed"
    if events_recorded:
        result["_events_recorded"] = True
    return result


def check_result_delivery(
    result: dict[str, Any], *, boundary: str, events_recorded: bool = False,
) -> dict[str, Any] | None:
    try:
        check_run_interruption(boundary)
    except LLMRunInterrupted as exc:
        return interrupted_delivery_result(result, exc.reason, events_recorded=events_recorded)
    return None
