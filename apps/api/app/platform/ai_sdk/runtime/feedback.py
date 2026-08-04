from __future__ import annotations

import json
from typing import Any

from app.platform.ai_sdk._immutability import thaw
from app.platform.ai_sdk.contracts import ChatMessage, MessageRole, ToolCall
from app.platform.ai_sdk.runtime.models import RuntimeLimits
from app.platform.ai_sdk.runtime.state import RuntimeState
from app.platform.ai_sdk.tools import RuntimeTool, RuntimeToolResult, ToolResultStatus, validate_json_schema


def parse_tool_arguments(
    call: ToolCall, tool: RuntimeTool
) -> tuple[dict[str, Any] | None, RuntimeToolResult | None]:
    try:
        value = json.loads(call.arguments_json or "{}")
    except json.JSONDecodeError:
        return None, RuntimeToolResult.failure("invalid_arguments", "Tool arguments are not valid JSON.")
    if not isinstance(value, dict):
        return None, RuntimeToolResult.failure("invalid_arguments", "Tool arguments must be a JSON object.")
    issues = validate_json_schema(value, tool.spec.input_schema)
    if issues:
        summary = ", ".join(
            f"{issue.code}@{'.'.join(map(str, issue.path)) or '$'}" for issue in issues
        )
        return None, RuntimeToolResult.failure(
            "invalid_arguments", f"Tool arguments do not match the declared schema: {summary}"
        )
    return value, None


def append_tool_feedback(
    state: RuntimeState,
    call_id: str,
    result: RuntimeToolResult,
    *,
    limits: RuntimeLimits | None = None,
) -> None:
    payload = (
        {"ok": True, "output": thaw(result.output)}
        if result.status is ToolResultStatus.SUCCESS
        else {
            "ok": False,
            "error": {
                "code": result.error_code or "tool_failure",
                "message": result.error_message or "Tool execution failed.",
                "retryable": result.retryable,
            },
        }
    )
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if limits is not None:
        remaining = max(0, limits.max_tool_output_chars - state.tool_output_chars)
        if len(serialized) > remaining:
            state.exhausted = True
            payload = {
                "ok": False,
                "error": {
                    "code": "tool_output_budget",
                    "message": "Tool output was omitted because the output budget is exhausted.",
                    "retryable": False,
                },
            }
            serialized = json.dumps(payload, separators=(",", ":"))
        state.tool_output_chars += min(len(serialized), remaining)
    state.messages.append(ChatMessage(MessageRole.TOOL, serialized, tool_call_id=call_id))
