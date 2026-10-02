"""Pure external-result validation/consumption; persistence belongs to injected ports."""
from __future__ import annotations

import json
from typing import Any

from app.platform.ai_sdk._immutability import thaw
from app.platform.ai_sdk.contracts import MessageRole, ToolCall
from app.platform.ai_sdk.runtime.feedback import ToolFeedbackFormatter, append_tool_feedback
from app.platform.ai_sdk.runtime.models import ExternalToolResolution, RuntimeCheckpoint, RuntimeLimits, RuntimePhase
from app.platform.ai_sdk.runtime.state import RuntimeState
from app.platform.ai_sdk.tools import RuntimeTool, ToolResultStatus, validate_json_schema


def external_wait_issue(state: RuntimeState) -> str | None:
    pending = state.pending
    if (pending is None or pending.attempt < 1 or not isinstance(state.external_operation_id, str)
            or not state.external_operation_id.strip()):
        return "External wait is missing its pending operation identity."
    if state.phase not in {RuntimePhase.EXTERNAL_RESULT_REQUIRED, RuntimePhase.INTERRUPTED}:
        return "External operation does not belong to a waiting checkpoint."
    if pending.call_id in state.completed_tool_call_ids or any(
        m.role is MessageRole.TOOL and m.tool_call_id == pending.call_id for m in state.messages
    ):
        return "External tool call already has a completed result."
    active = next((m for m in reversed(state.messages) if m.role is MessageRole.ASSISTANT), None)
    call = next((c for c in active.tool_calls if c.id == pending.call_id), None) if active else None
    try:
        matches = (call is not None and call.name == pending.name
                   and json.loads(call.arguments_json) == thaw(pending.arguments))
    except (ValueError, TypeError, RecursionError):
        matches = False
    if not matches:
        return "External pending tool does not match its original call."
    return None


def external_resolution_issue(
    state: RuntimeState, resolution: ExternalToolResolution, tool: RuntimeTool,
) -> str | None:
    pending = state.pending
    if (pending is None or resolution.run_id != state.run_id
            or resolution.tool_call_id != pending.call_id
            or resolution.operation_id != state.external_operation_id):
        return "External resolution does not match the waiting run, call, and operation."
    if (resolution.result.status is ToolResultStatus.SUCCESS and tool.output_schema
            and validate_json_schema(resolution.result.output, tool.output_schema)):
        return "External result does not match the tool output schema."
    return None


def consume_external_result(
    state: RuntimeState, resolution: ExternalToolResolution, *,
    tool: RuntimeTool, formatter: ToolFeedbackFormatter, context: Any, limits: RuntimeLimits,
) -> None:
    """Consume a verified result in memory; callers commit the resulting checkpoint."""
    issue = external_wait_issue(state) or external_resolution_issue(state, resolution, tool)
    if issue is not None:
        raise ValueError(issue)
    pending = state.pending
    assert pending is not None
    append_tool_feedback(
        state, ToolCall(pending.call_id, pending.name, json.dumps(thaw(pending.arguments), ensure_ascii=False)),
        resolution.result, formatter=formatter, tool=tool, context=context, limits=limits,
    )
    state.completed_tool_call_ids.append(pending.call_id)
    state.artifacts.extend(resolution.result.artifacts)
    state.pending = None
    state.external_operation_id = None
    state.phase = RuntimePhase.AFTER_TOOL



def resolve_external_checkpoint(
    checkpoint: RuntimeCheckpoint, resolution: ExternalToolResolution, *,
    tool: RuntimeTool, formatter: ToolFeedbackFormatter, context: Any = None,
    limits: RuntimeLimits | None = None,
) -> RuntimeCheckpoint:
    """Prepare one feedback without dispatch or persistence; the domain owns CAS.

    Unlike running the loop, this cannot start the next tool before the owner
    atomically commits its result, source frontier, and checkpoint.
    """
    validate_external_checkpoint(checkpoint)
    if checkpoint.pending is None or checkpoint.pending.name != tool.spec.name:
        raise ValueError("external_tool_identity_mismatch")
    state = RuntimeState.from_checkpoint(checkpoint)
    consume_external_result(state, resolution, tool=tool, formatter=formatter,
                            context=context, limits=limits or RuntimeLimits())
    state.sequence += 1
    return state.checkpoint()


def validate_external_checkpoint(checkpoint: RuntimeCheckpoint) -> None:
    """Reject non-durable or inconsistent waits before application publication."""
    if checkpoint.to_dict()["continuation_omitted"]:
        raise ValueError("provider_continuation_unavailable")
    if checkpoint.phase is not RuntimePhase.EXTERNAL_RESULT_REQUIRED:
        raise ValueError("external_checkpoint_not_waiting")
    issue = external_wait_issue(RuntimeState.from_checkpoint(checkpoint))
    if issue is not None:
        raise ValueError(issue)
