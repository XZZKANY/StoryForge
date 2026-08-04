from __future__ import annotations

from app.platform.ai_sdk import ChatMessage, ChatResponse, MessageRole, TokenUsage, ToolCall, ToolSpec
from app.platform.ai_sdk.observability import InMemoryUsageSink
from app.platform.ai_sdk.providers import DeterministicProvider
from app.platform.ai_sdk.runtime import RuntimeLimits, RuntimeResultStatus, ToolCallingRuntime
from app.platform.ai_sdk.tools import RuntimeTool, RuntimeToolResult, ToolRegistry

MESSAGES = (ChatMessage(MessageRole.USER, "go"),)


def _registry(output: str = "ok") -> ToolRegistry:
    return ToolRegistry(
        [
            RuntimeTool(
                spec=ToolSpec("work", "Work", {"type": "object"}),
                handler=lambda context, arguments: RuntimeToolResult.success({"value": output}),
                retry_safe=True,
                idempotent=True,
            )
        ]
    )


def test_zero_tool_budget_withdraws_tools_before_first_model_call() -> None:
    provider = DeterministicProvider(responses=[ChatResponse("final")])
    result = ToolCallingRuntime(provider, _registry()).run(
        MESSAGES,
        model="deterministic",
        run_id="run-zero-tools",
        limits=RuntimeLimits(max_tool_calls=0),
    )
    assert result.status is RuntimeResultStatus.COMPLETED
    assert result.exhausted is True
    assert provider.requests[0].tools == ()
    assert provider.requests[0].messages[-1].role is MessageRole.SYSTEM


def test_tool_output_budget_withdraws_tools_for_final_response() -> None:
    provider = DeterministicProvider(
        responses=[
            ChatResponse("", tool_calls=(ToolCall("call-1", "work", "{}"),)),
            ChatResponse("summarized"),
        ]
    )
    result = ToolCallingRuntime(provider, _registry("x" * 200)).run(
        MESSAGES,
        model="deterministic",
        run_id="run-output-budget",
        limits=RuntimeLimits(max_rounds=3, max_tool_output_chars=40),
    )
    assert result.content == "summarized"
    assert result.exhausted is True
    assert provider.requests[1].tools == ()


def test_token_and_cost_availability_remain_explicit() -> None:
    unavailable = ToolCallingRuntime(
        DeterministicProvider(responses=[ChatResponse("done")]), ToolRegistry()
    ).run(MESSAGES, model="deterministic", run_id="run-unavailable")
    assert unavailable.usage_available is False
    assert unavailable.cost_available is False
    assert unavailable.total_tokens == 0
    assert unavailable.total_cost is None

    usage_sink = InMemoryUsageSink(cost_per_1k_tokens=2.0)
    available = ToolCallingRuntime(
        DeterministicProvider(
            responses=[ChatResponse("done", usage=TokenUsage(700, 300, 1000, source="provider_usage"))]
        ),
        ToolRegistry(),
        usage_sink=usage_sink,
    ).run(MESSAGES, model="deterministic", run_id="run-available")
    assert available.usage_available is True
    assert available.cost_available is True
    assert available.total_cost == 2.0


def test_token_budget_blocks_tool_before_handler_and_withdraws_next_round() -> None:
    calls = 0

    def handler(context, arguments):
        nonlocal calls
        calls += 1
        return RuntimeToolResult.success({"value": "wrong"})

    tool = RuntimeTool(
        spec=ToolSpec("work", "Work", {"type": "object"}),
        handler=handler,
        retry_safe=True,
        idempotent=True,
    )
    provider = DeterministicProvider(
        responses=[
            ChatResponse(
                "",
                tool_calls=(ToolCall("call-1", "work", "{}"),),
                usage=TokenUsage(8, 2, 10, source="provider_usage"),
            ),
            ChatResponse("budget summary"),
        ]
    )
    result = ToolCallingRuntime(provider, ToolRegistry([tool])).run(
        MESSAGES,
        model="deterministic",
        run_id="run-token-budget",
        limits=RuntimeLimits(max_rounds=3, max_tokens=5),
    )
    assert result.content == "budget summary"
    assert result.exhausted is True
    assert calls == 0
    assert provider.requests[1].tools == ()


def test_cost_budget_blocks_tool_before_handler() -> None:
    calls = 0

    def handler(context, arguments):
        nonlocal calls
        calls += 1
        return RuntimeToolResult.success({"value": "wrong"})

    provider = DeterministicProvider(
        responses=[
            ChatResponse(
                "",
                tool_calls=(ToolCall("call-1", "work", "{}"),),
                usage=TokenUsage(500, 500, 1000, source="provider_usage"),
            ),
            ChatResponse("cost summary"),
        ]
    )
    runtime = ToolCallingRuntime(
        provider,
        ToolRegistry(
            [
                RuntimeTool(
                    spec=ToolSpec("work", "Work", {"type": "object"}),
                    handler=handler,
                    retry_safe=True,
                    idempotent=True,
                )
            ]
        ),
        usage_sink=InMemoryUsageSink(cost_per_1k_tokens=2.0),
    )
    result = runtime.run(
        MESSAGES,
        model="deterministic",
        run_id="run-cost-budget",
        limits=RuntimeLimits(max_rounds=3, max_cost=1.0),
    )
    assert result.content == "cost summary"
    assert result.exhausted is True
    assert calls == 0
