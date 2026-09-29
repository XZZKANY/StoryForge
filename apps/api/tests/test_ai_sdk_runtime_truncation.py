from __future__ import annotations

import pytest

from app.platform.ai_sdk import ChatMessage, ChatResponse, MessageRole, TokenUsage, ToolCall, ToolSpec
from app.platform.ai_sdk.observability import InMemoryRunTracer
from app.platform.ai_sdk.providers import DeterministicProvider
from app.platform.ai_sdk.runtime import RuntimeResultStatus, ToolCallingRuntime
from app.platform.ai_sdk.tools import RuntimeArtifact, RuntimeTool, RuntimeToolResult, ToolRegistry


@pytest.mark.parametrize("with_tool", [False, True])
@pytest.mark.parametrize("finish_reason, error_code", [("length", "model_output_truncated"), ("content_filter", "provider_content_filter")])
def test_incomplete_response_never_completes_or_executes_parseable_tool(with_tool, finish_reason, error_code):
    executions = []
    tool = RuntimeTool(
        ToolSpec("lookup", "Lookup", {"type": "object", "properties": {}}),
        lambda context, arguments: executions.append(arguments) or RuntimeToolResult.success({"ok": True}),
    )
    response = ChatResponse(
        "partial answer", finish_reason=finish_reason,
        tool_calls=(ToolCall("truncated-call", "lookup", "{}"),) if with_tool else (),
        usage=TokenUsage(10, 20, 30, source="provider_usage"),
    )
    provider = DeterministicProvider(responses=[response, ChatResponse("must not run")])
    tracer = InMemoryRunTracer()
    result = ToolCallingRuntime(provider, ToolRegistry([tool]), tracer=tracer).run(
        [ChatMessage(MessageRole.USER, "review")], model="fixture", run_id="truncated",
    )
    assert result.status is RuntimeResultStatus.FAILED
    assert result.error_code == error_code
    assert len(provider.requests) == 1
    assert executions == []
    assert result.total_tokens == 30
    assert result.usage_available
    assert not any(event.kind in {"tool_started", "runtime_completed"} for event in tracer.events)
    assert not any(message.content == "partial answer" for message in result.messages)


def test_truncation_preserves_previously_completed_tool_evidence_and_usage():
    provider = DeterministicProvider(responses=[
        ChatResponse("", tool_calls=(ToolCall("safe-call", "lookup", "{}"),), usage=TokenUsage(3, 2, 5, source="provider_usage")),
        ChatResponse("partial", finish_reason="length", usage=TokenUsage(4, 3, 7, source="provider_usage")),
    ])
    tool = RuntimeTool(
        ToolSpec("lookup", "Lookup", {"type": "object", "properties": {}}),
        lambda context, arguments: RuntimeToolResult.success({"ok": True}, artifacts=(RuntimeArtifact("review", {"id": "review-1"}),)),
    )
    result = ToolCallingRuntime(provider, ToolRegistry([tool])).run(
        [ChatMessage(MessageRole.USER, "review")], model="fixture", run_id="partial",
    )
    assert result.status is RuntimeResultStatus.FAILED
    assert result.error_code == "model_output_truncated"
    assert result.tool_attempts == 1
    assert result.total_tokens == 12
    assert result.artifacts[0].payload["id"] == "review-1"
    assert any(message.role is MessageRole.TOOL for message in result.messages)
