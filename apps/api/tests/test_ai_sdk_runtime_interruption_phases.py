from __future__ import annotations

import json
from dataclasses import dataclass, replace

import pytest

from app.platform.ai_sdk import ChatMessage, ChatResponse, MessageRole, TokenUsage, ToolCall, ToolSpec
from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails
from app.platform.ai_sdk.observability import InMemoryRunTracer, InMemoryUsageSink
from app.platform.ai_sdk.providers import DeterministicProvider
from app.platform.ai_sdk.runtime import (
    DefaultRuntimePolicy,
    InMemoryCheckpointStore,
    ResumeAction,
    ResumeCommand,
    RuntimeCheckpoint,
    RuntimeLimits,
    RuntimePhase,
    RuntimeResultStatus,
    ToolCallingRuntime,
)
from app.platform.ai_sdk.tools import RuntimeArtifact, RuntimeTool, RuntimeToolResult, ToolRegistry

MESSAGES = (ChatMessage(MessageRole.USER, "work"),)
CALL = ToolCall("first", "work", "{}")


@dataclass
class StopControl:
    reason: str | None = None
    boundary: str | None = None

    def check(self, run_id, boundary, checkpoint):
        if boundary == self.boundary:
            self.reason = "stopped"
        return self.reason


def registry(handler, *, requires_approval=False):
    return ToolRegistry([
        RuntimeTool(
            ToolSpec("work", "Work", {"type": "object"}),
            handler,
            retry_safe=True,
            idempotent=True,
            requires_approval=requires_approval,
        )
    ])


class HookTracer(InMemoryRunTracer):
    def __init__(self, control, kind):
        super().__init__()
        self.control, self.kind = control, kind

    def emit(self, event):
        super().emit(event)
        if event.kind == self.kind:
            self.control.reason = "stopped"


class HookStore(InMemoryCheckpointStore):
    def __init__(self, control, phase):
        super().__init__()
        self.control, self.phase = control, phase

    def save(self, checkpoint):
        super().save(checkpoint)
        if checkpoint.phase is self.phase:
            self.control.reason = "stopped"


@pytest.mark.parametrize("hook", ["selector", "model_started", "before_model_dispatch"])
def test_cancel_after_model_setup_never_dispatches_provider(hook):
    control = StopControl(boundary=hook)

    class Selector:
        def select(self, tools, context):
            if hook == "selector":
                control.reason = "stopped"
            return tools.all()

    provider = DeterministicProvider([ChatResponse("done")])
    result = ToolCallingRuntime(
        provider, ToolRegistry(), selector=Selector(), tracer=HookTracer(control, hook),
        interruption=control.check,
    ).run(MESSAGES, model="test", run_id="setup")
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert provider.requests == []
    assert result.checkpoint.round_count == 0


@pytest.mark.parametrize("hook", ["provider", "usage", "model_completed", "after_model"])
def test_model_result_records_real_usage_before_cancel_and_never_dispatches_tools(hook):
    control = StopControl(boundary=hook)
    calls = []

    class Provider(DeterministicProvider):
        def complete(self, request):
            response = super().complete(request)
            if hook == "provider":
                control.reason = "stopped"
            return response

    class Usage(InMemoryUsageSink):
        def record(self, run_id, round_number, usage):
            cost = super().record(run_id, round_number, usage)
            if hook == "usage":
                control.reason = "stopped"
            return cost

    usage = Usage(cost_per_1k_tokens=1)
    provider = Provider([ChatResponse("", tool_calls=(CALL,), usage=TokenUsage(3, 4, 7, source="provider"))])
    runtime = ToolCallingRuntime(
        provider, registry(lambda context, arguments: calls.append(arguments)),
        usage_sink=usage, tracer=HookTracer(control, hook), interruption=control.check,
    )
    result = runtime.run(MESSAGES, model="test", run_id="after-model")
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert (result.total_tokens, result.total_cost) == (7, 0.007)
    assert len(usage.records) == 1
    assert calls == []
    assert result.tool_attempts == 0
    control.reason = control.boundary = None
    resumed = runtime.run(
        (), model="test", run_id="after-model", resume_state=result.checkpoint,
        resume_command=ResumeCommand(ResumeAction.CONTINUE),
    )
    assert resumed.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert len(provider.requests) == 1


@pytest.mark.parametrize("hook", [
    "before_tool_dispatch", "policy", "tool_started", "checkpoint_started", "approval_saved",
])
def test_cancel_after_tool_policy_or_durability_hook_prevents_handler(hook):
    control = StopControl(boundary=hook)
    calls = []

    class Policy(DefaultRuntimePolicy):
        def decide_tool(self, tool, call, context):
            decision = super().decide_tool(tool, call, context)
            if hook == "policy":
                control.reason = "stopped"
            return decision

    phase = RuntimePhase.APPROVAL_REQUIRED if hook == "approval_saved" else RuntimePhase.TOOL_STARTED
    store = HookStore(control, phase) if hook in {"checkpoint_started", "approval_saved"} else None
    result = ToolCallingRuntime(
        DeterministicProvider([ChatResponse("", tool_calls=(CALL,))]),
        registry(lambda context, arguments: calls.append(arguments), requires_approval=hook == "approval_saved"),
        policy=Policy(), tracer=HookTracer(control, hook), checkpoints=store,
        interruption=control.check,
    ).run(MESSAGES, model="test", run_id="before-tool")
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert calls == []
    assert result.tool_attempts == 0


@pytest.mark.parametrize("hook", ["handler", "tool_completed", "checkpoint_finished", "after_tool"])
def test_cancel_mid_batch_preserves_completed_fact_and_requires_reconciliation_on_continue(hook):
    control = StopControl(boundary=hook)
    calls = []
    artifact = RuntimeArtifact("proposal", {"text": "finished"})

    def handler(context, arguments):
        calls.append("first")
        if hook == "handler":
            control.reason = "stopped"
        return RuntimeToolResult.success({"done": True}, artifacts=(artifact,))

    provider = DeterministicProvider([
        ChatResponse("", tool_calls=(CALL, ToolCall("second", "work", "{}"))), ChatResponse("done"),
    ])
    store = HookStore(control, RuntimePhase.AFTER_TOOL) if hook == "checkpoint_finished" else None
    runtime = ToolCallingRuntime(
        provider, registry(handler), interruption=control.check,
        tracer=HookTracer(control, hook), checkpoints=store,
    )
    result = runtime.run(MESSAGES, model="test", run_id="batch")
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert calls == ["first"]
    assert result.tool_attempts == 1
    assert result.artifacts == (artifact,)
    assert result.checkpoint.completed_tool_call_ids == ("first",)
    assert [message.tool_call_id for message in result.messages if message.role is MessageRole.TOOL] == ["first"]
    control.reason = control.boundary = None
    restored = RuntimeCheckpoint.from_dict(json.loads(json.dumps(result.checkpoint.to_dict())))
    resumed = runtime.run(
        (), model="test", run_id="batch", resume_state=restored,
        resume_command=ResumeCommand(ResumeAction.CONTINUE),
    )
    assert resumed.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert calls == ["first"]
    assert len(provider.requests) == 1


@pytest.mark.parametrize("hook", ["handler", "tool_failed", "retry_policy", "before_tool_attempt"])
def test_cancel_before_retry_preserves_returned_failure_and_never_executes_again(hook):
    control = StopControl()
    calls = []

    def handler(context, arguments):
        calls.append("attempt")
        if hook == "handler":
            control.reason = "stopped"
        return RuntimeToolResult.failure("temporary", "Try again", retryable=True)

    class Policy(DefaultRuntimePolicy):
        def should_retry(self, tool, result_retryable, attempt):
            if hook == "retry_policy":
                control.reason = "stopped"
            if hook == "before_tool_attempt":
                control.boundary = hook
            return super().should_retry(tool, result_retryable, attempt)

    result = ToolCallingRuntime(
        DeterministicProvider([ChatResponse("", tool_calls=(CALL,)), ChatResponse("done")]),
        registry(handler), interruption=control.check, policy=Policy(), tracer=HookTracer(control, hook),
    ).run(MESSAGES, model="test", run_id="retry")
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert calls == ["attempt"]
    assert result.tool_attempts == 1
    assert result.checkpoint.pending is None
    assert result.checkpoint.completed_tool_call_ids == ("first",)
    assert "temporary" in result.messages[-1].content


def test_cancelled_handler_exception_keeps_unknown_outcome_pending_for_reconciliation():
    control = StopControl()

    def handler(context, arguments):
        control.reason = "stopped"
        raise RuntimeError("opaque transport interrupted")

    provider = DeterministicProvider([ChatResponse("", tool_calls=(CALL,)), ChatResponse("done")])
    runtime = ToolCallingRuntime(provider, registry(handler), interruption=control.check)
    result = runtime.run(MESSAGES, model="test", run_id="unknown")
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert result.tool_attempts == 1
    assert result.checkpoint.pending.call_id == "first"
    assert result.checkpoint.completed_tool_call_ids == ()
    assert not any(message.role is MessageRole.TOOL for message in result.messages)
    control.reason = None
    resumed = runtime.run(
        (), model="test", run_id="unknown", resume_state=result.checkpoint,
        resume_command=ResumeCommand(ResumeAction.CONTINUE),
    )
    assert resumed.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert len(provider.requests) == 1


@pytest.mark.parametrize("budget", ["tokens", "cost", "output"])
def test_approved_resume_checks_all_known_budgets_before_tool_side_effect(budget):
    calls = []
    provider = DeterministicProvider([ChatResponse("", tool_calls=(CALL,)), ChatResponse("done")])
    runtime = ToolCallingRuntime(
        provider, registry(lambda context, arguments: calls.append(arguments), requires_approval=True),
    )
    pending = runtime.run(MESSAGES, model="test", run_id="budget")
    checkpoint = replace(
        pending.checkpoint, total_tokens=10, usage_available=True, total_cost=1.0,
        cost_available=True, tool_output_chars=100,
    )
    limits = {
        "tokens": RuntimeLimits(max_tokens=10),
        "cost": RuntimeLimits(max_cost=1.0),
        "output": RuntimeLimits(max_tool_output_chars=100),
    }[budget]
    result = runtime.run(
        (), model="test", run_id="budget", limits=limits, resume_state=checkpoint,
        resume_command=ResumeCommand(ResumeAction.APPROVE, tool_call_id="first"),
    )
    assert result.status is RuntimeResultStatus.COMPLETED
    assert calls == []
    assert result.tool_attempts == 0
    assert result.exhausted
    assert provider.requests[-1].tools == ()


def test_last_allowed_tool_attempt_is_executed_but_next_retry_is_not():
    calls = []

    def handler(context, arguments):
        calls.append("attempt")
        return RuntimeToolResult.failure("temporary", "Try again", retryable=True)

    result = ToolCallingRuntime(
        DeterministicProvider([ChatResponse("", tool_calls=(CALL,)), ChatResponse("done")]), registry(handler),
    ).run(MESSAGES, model="test", run_id="attempt-budget", limits=RuntimeLimits(max_tool_calls=1))
    assert result.status is RuntimeResultStatus.COMPLETED
    assert calls == ["attempt"]
    assert result.tool_attempts == 1
    assert "temporary" in result.messages[-3].content


def test_late_stop_after_completed_checkpoint_does_not_reclassify_terminal_result():
    control = StopControl()
    tracer = InMemoryRunTracer()
    result = ToolCallingRuntime(
        DeterministicProvider([ChatResponse("done")]), ToolRegistry(), interruption=control.check,
        checkpoints=HookStore(control, RuntimePhase.COMPLETED), tracer=tracer,
    ).run(MESSAGES, model="test", run_id="before-completed")
    assert result.status is RuntimeResultStatus.COMPLETED
    assert result.content == "done"
    assert "runtime_completed" in [event.kind for event in tracer.events]


@pytest.mark.parametrize("error_kind", ["provider", "control"])
def test_model_error_with_latched_cancel_returns_interruption_without_sdk_adapter_import(error_kind):
    control = StopControl()

    class Provider(DeterministicProvider):
        def complete(self, request):
            self.requests.append(request)
            control.reason = "stopped"
            if error_kind == "provider":
                raise ProviderError(ProviderErrorDetails(ProviderErrorCategory.TIMEOUT, "timeout"))
            raise RuntimeError("external control exception")

    provider = Provider()
    result = ToolCallingRuntime(provider, ToolRegistry(), interruption=control.check).run(
        MESSAGES, model="test", run_id="cancelled-model-error",
    )
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert result.error_code is None
    assert len(provider.requests) == 1
    assert result.messages == MESSAGES
    assert not result.usage_available


def test_unknown_model_exception_without_latched_cancel_is_not_hidden():
    class Provider(DeterministicProvider):
        def complete(self, request):
            raise RuntimeError("adapter bug")

    with pytest.raises(RuntimeError, match="adapter bug"):
        ToolCallingRuntime(Provider(), ToolRegistry(), interruption=StopControl().check).run(
            MESSAGES, model="test", run_id="model-bug",
        )


def test_text_only_model_completion_observes_cancel_after_usage_without_claiming_success():
    control = StopControl(boundary="after_model")
    result = ToolCallingRuntime(
        DeterministicProvider([ChatResponse("finished text", usage=TokenUsage(1, 2, 3, source="provider"))]),
        ToolRegistry(), interruption=control.check,
    ).run(MESSAGES, model="test", run_id="text-cancel")
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert result.content == ""
    assert result.total_tokens == 3
    assert result.messages[-1].content == "finished text"


def test_cancelled_approval_resume_never_executes_approved_handler():
    control = StopControl()
    calls = []
    provider = DeterministicProvider([ChatResponse("", tool_calls=(CALL,)), ChatResponse("done")])
    runtime = ToolCallingRuntime(
        provider, registry(lambda context, arguments: calls.append(arguments), requires_approval=True),
        interruption=control.check,
    )
    approval = runtime.run(MESSAGES, model="test", run_id="approved-stop")
    control.reason = "stopped"
    result = runtime.run(
        (), model="test", run_id="approved-stop", resume_state=approval.checkpoint,
        resume_command=ResumeCommand(ResumeAction.APPROVE),
    )
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert calls == []
    assert result.tool_attempts == 0
    assert result.checkpoint.pending.call_id == "first"


def test_fully_settled_batch_can_continue_without_replaying_finished_tool():
    control = StopControl()
    calls = []

    def handler(context, arguments):
        calls.append("executed")
        control.reason = "paused"
        return RuntimeToolResult.success({"done": True})

    provider = DeterministicProvider([ChatResponse("", tool_calls=(CALL,)), ChatResponse("done")])
    runtime = ToolCallingRuntime(provider, registry(handler), interruption=control.check)
    paused = runtime.run(MESSAGES, model="test", run_id="settled")
    assert paused.status is RuntimeResultStatus.INTERRUPTED
    control.reason = None
    resumed = runtime.run(
        (), model="test", run_id="settled", resume_state=paused.checkpoint,
        resume_command=ResumeCommand(ResumeAction.CONTINUE),
    )
    assert resumed.status is RuntimeResultStatus.COMPLETED
    assert calls == ["executed"]
    assert len(provider.requests) == 2
    assert provider.requests[-1].messages[-1].role is MessageRole.TOOL


@pytest.mark.parametrize("finish_reason", ["length", "content_filter"])
def test_incomplete_model_response_still_observes_cancel_after_usage_without_history_pollution(finish_reason):
    control = StopControl(boundary="after_model")
    calls = []
    result = ToolCallingRuntime(
        DeterministicProvider([
            ChatResponse("partial", tool_calls=(CALL,), finish_reason=finish_reason,
                         usage=TokenUsage(1, 2, 3, source="provider")),
        ]),
        registry(lambda context, arguments: calls.append(arguments)), interruption=control.check,
    ).run(MESSAGES, model="test", run_id="partial-cancel")
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert result.total_tokens == 3
    assert result.messages == MESSAGES
    assert calls == []
