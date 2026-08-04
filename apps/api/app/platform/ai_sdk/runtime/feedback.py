from __future__ import annotations

import json
from typing import Any, Protocol

from app.platform.ai_sdk.contracts import ChatMessage, MessageRole, ToolCall
from app.platform.ai_sdk.runtime.models import RuntimeLimits
from app.platform.ai_sdk.runtime.state import RuntimeState
from app.platform.ai_sdk.tools import RuntimeTool, RuntimeToolResult, ToolResultStatus, validate_json_schema


class ToolFeedbackFormatter(Protocol):
    def format(
        self,
        result: RuntimeToolResult,
        *,
        call: ToolCall,
        tool: RuntimeTool | None,
        context: Any,
    ) -> str: ...


class JsonToolFeedbackFormatter:
    def format(
        self,
        result: RuntimeToolResult,
        *,
        call: ToolCall,
        tool: RuntimeTool | None,
        context: Any,
    ) -> str:
        del call, tool, context
        payload = (
            {"ok": True, "output": result.to_output()}
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
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


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
    call: ToolCall,
    result: RuntimeToolResult,
    *,
    formatter: ToolFeedbackFormatter,
    tool: RuntimeTool | None = None,
    context: Any = None,
    limits: RuntimeLimits | None = None,
) -> None:
    serialized = formatter.format(result, call=call, tool=tool, context=context)
    if limits is not None:
        remaining = max(0, limits.max_tool_output_chars - state.tool_output_chars)
        if len(serialized) > remaining:
            state.exhausted = True
            serialized = formatter.format(
                RuntimeToolResult.failure(
                    "tool_output_budget",
                    "Tool output was omitted because the output budget is exhausted.",
                ),
                call=call,
                tool=tool,
                context=context,
            )
        state.tool_output_chars += min(len(serialized), remaining)
    state.messages.append(ChatMessage(MessageRole.TOOL, serialized, tool_call_id=call.id))
