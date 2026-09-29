from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class AgentRuntimeInterruption(BaseModel):
    """Shared minimum contract for settled cooperative interruption results."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    status: Literal["paused", "stopped"]
    boundary: str


class AgentExecutionOutcome(BaseModel):
    """Non-success execution outcome, independent of an artifact's approval state."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    status: Literal["failed", "partial"]
    code: str
    message: str


def execution_result_payload(result: Mapping[str, Any]) -> dict[str, Any]:
    """Keep the public result for lossless reconnect; never persist internal artifacts/ports."""
    return {"execution_result": deepcopy({key: value for key, value in result.items() if not key.startswith("_")})}


def resolve_execution_result(payload: Mapping[str, Any], *, approved: bool) -> dict[str, Any]:
    raw = payload.get("execution_result")
    if not isinstance(raw, dict):
        return {}
    result = deepcopy(raw)
    result["proposed_patch"] = None
    agent_result = result["agent_result"]
    agent_result["requires_user_confirmation"] = False
    agent_result["writeback_blocked_until_user_confirms"] = False
    agent_result["patch_resolution"] = "approved" if approved else "denied"
    for step in result.get("plan", []):
        if step.get("step") == "permission.confirm":
            step["status"] = "completed" if approved else "failed"
            step["detail"] = "作者已批准提案；文件写回由 Desktop 执行。" if approved else "作者已拒绝提案。"
    return {"execution_result": result}
