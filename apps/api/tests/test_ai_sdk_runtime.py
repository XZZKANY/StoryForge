from __future__ import annotations

from app.platform.ai_sdk import (
    ChatMessage,
    ChatResponse,
    MessageRole,
    ProviderError,
    ProviderErrorCategory,
    ProviderErrorDetails,
    TokenUsage,
    ToolCall,
    ToolSpec,
)
from app.platform.ai_sdk.observability import InMemoryRunTracer
from app.platform.ai_sdk.providers import DeterministicProvider
from app.platform.ai_sdk.runtime import RuntimeLimits, RuntimeResultStatus, ToolCallingRuntime
from app.platform.ai_sdk.tools import RuntimeArtifact, RuntimeTool, RuntimeToolResult, ToolRegistry


def _messages() -> tuple[ChatMessage, ...]:
    return (ChatMessage(MessageRole.USER, "lookup"),)


def _registry(handler=None) -> ToolRegistry:
    return ToolRegistry(
        [
            RuntimeTool(
                spec=ToolSpec(
                    "lookup",
                    "Lookup",
                    {
                        "type": "object",
                        "properties": {"key": {"type": "string"}},
                        "required": ["key"],
                    },
                ),
                handler=handler
                or (lambda context, arguments: RuntimeToolResult.success({"value": arguments["key"]})),
                retry_safe=True,
                idempotent=True,
            )
        ]
    )


def test_runtime_completes_without_tools_and_records_usage_trace() -> None:
    tracer = InMemoryRunTracer()
    provider = DeterministicProvider(
        responses=[
            ChatResponse(
                "answer",
                usage=TokenUsage(4, 2, 6, source="provider_usage"),
                finish_reason="stop",
            )
        ]
    )
    result = ToolCallingRuntime(provider, ToolRegistry(), tracer=tracer).run(
        _messages(), model="deterministic", run_id="run-text"
    )
    assert result.status is RuntimeResultStatus.COMPLETED
    assert result.content == "answer"
    assert result.total_tokens == 6
    assert result.usage_available is True
    assert [event.kind for event in tracer.events] == [
        "runtime_started",
        "model_started",
        "model_completed",
        "checkpoint_saved",
        "runtime_completed",
    ]
    assert [event.sequence for event in tracer.events] == [1, 2, 3, 4, 5]


def test_runtime_executes_multi_round_tool_call_and_returns_artifacts() -> None:
    context = {"opaque": True}
    tracer = InMemoryRunTracer()

    def handler(application_context, arguments):
        assert application_context is context
        return RuntimeToolResult.success(
            {"value": arguments["key"]},
            artifacts=(RuntimeArtifact("lookup", {"key": arguments["key"]}),),
        )

    provider = DeterministicProvider(
        responses=[
            ChatResponse("", tool_calls=(ToolCall("call-1", "lookup", '{"key":"x"}'),)),
            ChatResponse("final"),
        ]
    )
    result = ToolCallingRuntime(provider, _registry(handler), tracer=tracer).run(
        _messages(),
        model="deterministic",
        run_id="run-tool",
        application_context=context,
        limits=RuntimeLimits(max_rounds=3),
    )
    assert result.status is RuntimeResultStatus.COMPLETED
    assert result.content == "final"
    assert result.tool_attempts == 1
    assert result.artifacts[0].kind == "lookup"
    assert provider.requests[1].messages[-1].role is MessageRole.TOOL
    assert '"value":"x"' in (provider.requests[1].messages[-1].content or "").replace(" ", "")
    assert [event.kind for event in tracer.events] == [
        "runtime_started",
        "model_started",
        "model_completed",
        "tool_started",
        "checkpoint_saved",
        "tool_completed",
        "checkpoint_saved",
        "model_started",
        "model_completed",
        "checkpoint_saved",
        "runtime_completed",
    ]


def test_runtime_returns_unknown_and_invalid_arguments_to_model() -> None:
    provider = DeterministicProvider(
        responses=[
            ChatResponse(
                "",
                tool_calls=(
                    ToolCall("missing", "not_registered", "{}"),
                    ToolCall("invalid", "lookup", '{"key":3}'),
                ),
            ),
            ChatResponse("recovered"),
        ]
    )
    result = ToolCallingRuntime(provider, _registry()).run(
        _messages(), model="deterministic", run_id="run-errors", limits=RuntimeLimits(max_rounds=3)
    )
    assert result.content == "recovered"
    feedback = [message.content or "" for message in provider.requests[1].messages if message.role is MessageRole.TOOL]
    assert any("unknown_tool" in item for item in feedback)
    assert any("invalid_arguments" in item for item in feedback)


def test_runtime_retries_only_safe_idempotent_retryable_tool() -> None:
    attempts = 0

    def handler(context, arguments):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return RuntimeToolResult.failure("temporary", "temporary failure", retryable=True)
        return RuntimeToolResult.success({"value": "ok"})

    provider = DeterministicProvider(
        responses=[
            ChatResponse("", tool_calls=(ToolCall("call-1", "lookup", '{"key":"x"}'),)),
            ChatResponse("done"),
        ]
    )
    result = ToolCallingRuntime(provider, _registry(handler)).run(
        _messages(), model="deterministic", run_id="run-retry", limits=RuntimeLimits(max_rounds=3)
    )
    assert result.content == "done"
    assert result.tool_attempts == 2
    assert attempts == 2


def test_runtime_does_not_retry_retryable_failure_for_unsafe_tool() -> None:
    attempts = 0

    def handler(context, arguments):
        nonlocal attempts
        attempts += 1
        return RuntimeToolResult.failure("temporary", "temporary failure", retryable=True)

    tool = RuntimeTool(
        spec=ToolSpec("unsafe", "Unsafe", {"type": "object"}),
        handler=handler,
        retry_safe=False,
        idempotent=False,
    )
    provider = DeterministicProvider(
        responses=[
            ChatResponse("", tool_calls=(ToolCall("call-1", "unsafe", "{}"),)),
            ChatResponse("done"),
        ]
    )
    result = ToolCallingRuntime(provider, ToolRegistry([tool])).run(
        _messages(), model="deterministic", run_id="run-unsafe", limits=RuntimeLimits(max_rounds=3)
    )
    assert result.content == "done"
    assert attempts == 1


def test_selector_hidden_tool_cannot_execute_even_if_provider_names_it() -> None:
    calls = 0

    def handler(context, arguments):
        nonlocal calls
        calls += 1
        return RuntimeToolResult.success({"value": "wrong"})

    class HideAll:
        def select(self, registry, context):
            return ()

    provider = DeterministicProvider(
        responses=[
            ChatResponse("", tool_calls=(ToolCall("call-1", "lookup", '{"key":"x"}'),)),
            ChatResponse("done"),
        ]
    )
    result = ToolCallingRuntime(provider, _registry(handler), selector=HideAll()).run(
        _messages(), model="deterministic", run_id="run-hidden", limits=RuntimeLimits(max_rounds=3)
    )
    assert result.content == "done"
    assert calls == 0
    assert "tool_not_available" in (provider.requests[1].messages[-1].content or "")


def test_runtime_normalizes_provider_failure() -> None:
    provider = DeterministicProvider(
        responses=[ProviderError(ProviderErrorDetails(ProviderErrorCategory.RATE_LIMIT, "safe", retryable=True))]
    )
    result = ToolCallingRuntime(provider, ToolRegistry()).run(
        _messages(), model="deterministic", run_id="run-provider-error"
    )
    assert result.status is RuntimeResultStatus.FAILED
    assert result.error_code == "provider_rate_limit"
    assert result.error_message == "safe"
