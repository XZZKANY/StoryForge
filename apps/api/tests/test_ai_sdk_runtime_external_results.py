from __future__ import annotations

import json
from dataclasses import replace

import pytest

from app.platform.ai_sdk import ChatMessage, ChatResponse, MessageRole, ProviderContinuation, ToolCall, ToolSpec
from app.platform.ai_sdk.observability import InMemoryRunTracer
from app.platform.ai_sdk.providers import DeterministicProvider
from app.platform.ai_sdk.runtime import (
    InMemoryCheckpointStore,
    ResumeAction,
    ResumeCommand,
    RuntimeCheckpoint,
    RuntimeLimits,
    RuntimeResultStatus,
    ToolCallingRuntime,
)
from app.platform.ai_sdk.tools import RuntimeArtifact, RuntimeTool, RuntimeToolResult, ToolRegistry

MESSAGES = (ChatMessage(MessageRole.USER, "revise then read"),)
OPERATION = "external-1"


def registry(calls: list[str], *, retry_safe: bool = False) -> ToolRegistry:
    def propose(context, arguments):
        calls.append("propose")
        return RuntimeToolResult.deferred(
            OPERATION, artifacts=(RuntimeArtifact("proposal", {"before": "old", "after": "new"}),),
        )

    def read(context, arguments):
        calls.append("read")
        return RuntimeToolResult.success({"text": "new"})

    return ToolRegistry([
        RuntimeTool(ToolSpec("propose", "Propose", {"type": "object"}), propose,
                    retry_safe=retry_safe, idempotent=retry_safe,
                    output_schema={"type": "object", "required": ["applied"],
                                   "properties": {"applied": {"type": "boolean"}}}),
        RuntimeTool(ToolSpec("read", "Read", {"type": "object"}), read),
    ])


def provider(*, continuation=None):
    return DeterministicProvider(responses=[
        ChatResponse("", tool_calls=(ToolCall("write-call", "propose", "{}"),
                                     ToolCall("read-call", "read", "{}")),
                     continuation=continuation),
        ChatResponse("checked"),
    ])


def resolution(**changes):
    from app.platform.ai_sdk.runtime import ExternalToolResolution
    args = {"run_id": "run", "tool_call_id": "write-call", "operation_id": OPERATION,
            "result": RuntimeToolResult.success({"applied": True})}
    args.update(changes)
    return ExternalToolResolution(**args)


def restore(checkpoint):
    assert checkpoint is not None
    return RuntimeCheckpoint.from_dict(json.loads(json.dumps(checkpoint.to_dict())))


def test_external_wait_preserves_pending_batch_without_success_or_further_dispatch():
    calls = []
    llm = provider()
    tracer = InMemoryRunTracer()
    store = InMemoryCheckpointStore()
    runtime = ToolCallingRuntime(llm, registry(calls), tracer=tracer, checkpoints=store)
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    assert waiting.status.value == "external_result_required"
    assert calls == ["propose"]
    assert len(llm.requests) == 1
    assert not any(m.role is MessageRole.TOOL for m in waiting.messages)
    assert waiting.checkpoint.pending.call_id == "write-call"
    assert waiting.checkpoint.completed_tool_call_ids == ()
    assert waiting.checkpoint.external_operation_id == OPERATION
    assert len(waiting.artifacts) == 1
    assert not any(e.kind == "tool_completed" for e in tracer.events)
    assert store.load("run").sequence == waiting.checkpoint.sequence


def test_external_result_resumes_same_run_after_json_roundtrip_without_replaying_handler():
    calls = []
    llm = provider()
    store = InMemoryCheckpointStore()
    runtime = ToolCallingRuntime(llm, registry(calls), checkpoints=store)
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    resumed = runtime.run((), model="test", run_id="run", resume_state=restore(waiting.checkpoint),
                          external_result=resolution())
    assert resumed.status is RuntimeResultStatus.COMPLETED
    assert resumed.run_id == "run"
    assert calls == ["propose", "read"]
    assert resumed.tool_attempts == 2
    assert len(llm.requests) == 2
    results = [m for m in llm.requests[-1].messages if m.role is MessageRole.TOOL]
    assert [m.tool_call_id for m in results] == ["write-call", "read-call"]
    assert json.loads(results[0].content)["output"] == {"applied": True}
    assert len(resumed.artifacts) == 1
    complete = store.load("run")
    assert complete.external_operation_id is None
    assert complete.completed_tool_call_ids == ("write-call", "read-call")
    replay = runtime.run((), model="test", run_id="run", resume_state=restore(complete),
                         external_result=resolution())
    assert replay.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert len(llm.requests) == 2
    assert calls == ["propose", "read"]


@pytest.mark.parametrize("command", [None, ResumeCommand(ResumeAction.CONTINUE),
                                    ResumeCommand(ResumeAction.APPROVE, "write-call")])
@pytest.mark.parametrize("retry_safe", [False, True])
def test_approval_continue_or_retry_policy_cannot_bypass_external_wait(command, retry_safe):
    calls = []
    llm = provider()
    runtime = ToolCallingRuntime(llm, registry(calls, retry_safe=retry_safe))
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    still_waiting = runtime.run((), model="test", run_id="run", resume_state=restore(waiting.checkpoint),
                                resume_command=command)
    assert still_waiting.status.value == "external_result_required"
    assert calls == ["propose"]
    assert len(llm.requests) == 1


@pytest.mark.parametrize("changes", [{"run_id": "other"}, {"tool_call_id": "other"},
                                     {"operation_id": "other"}])
def test_wrong_external_identity_preserves_wait_without_dispatch(changes):
    calls = []
    llm = provider()
    store = InMemoryCheckpointStore()
    runtime = ToolCallingRuntime(llm, registry(calls), checkpoints=store)
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    result = runtime.run((), model="test", run_id="run", resume_state=restore(waiting.checkpoint),
                         external_result=resolution(**changes))
    assert result.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert store.load("run").external_operation_id == OPERATION
    assert calls == ["propose"]
    assert len(llm.requests) == 1


def test_external_resolution_requires_a_waiting_checkpoint():
    calls = []
    llm = provider()
    result = ToolCallingRuntime(llm, registry(calls)).run(
        MESSAGES, model="test", run_id="run", external_result=resolution(),
    )
    assert result.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert calls == []
    assert llm.requests == []


def test_failed_external_result_is_feedback_not_handler_retry():
    calls = []
    llm = provider()
    runtime = ToolCallingRuntime(llm, registry(calls, retry_safe=True))
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    result = runtime.run(
        (), model="test", run_id="run", resume_state=restore(waiting.checkpoint),
        external_result=resolution(result=RuntimeToolResult.failure("not_written", "Refused.", retryable=True)),
    )
    assert result.status is RuntimeResultStatus.COMPLETED
    assert calls == ["propose", "read"]
    assert "Refused." in next(m.content for m in result.messages if m.tool_call_id == "write-call")


def test_invalid_external_output_keeps_pending_for_reconciliation():
    calls = []
    llm = provider()
    runtime = ToolCallingRuntime(llm, registry(calls))
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    result = runtime.run(
        (), model="test", run_id="run", resume_state=restore(waiting.checkpoint),
        external_result=resolution(result=RuntimeToolResult.success({"applied": "yes"})),
    )
    assert result.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert result.checkpoint.pending.call_id == "write-call"
    assert len(llm.requests) == 1


def test_native_continuation_never_publishes_executable_external_wait():
    calls = []
    llm = provider(continuation=ProviderContinuation("test", {"signature": "opaque"}))
    tracer = InMemoryRunTracer()
    runtime = ToolCallingRuntime(llm, registry(calls), tracer=tracer)
    result = runtime.run(MESSAGES, model="test", run_id="run")
    assert result.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert result.checkpoint.to_dict()["continuation_omitted"] is True
    assert not any(e.kind == "external_result_required" for e in tracer.events)
    resumed = runtime.run((), model="test", run_id="run", resume_state=result.checkpoint,
                          resume_command=ResumeCommand(ResumeAction.CONTINUE), external_result=resolution())
    assert resumed.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert calls == ["propose"]
    assert len(llm.requests) == 1


@pytest.mark.parametrize("reason", ["paused", "stopped"])
def test_interrupted_external_wait_retains_identity_and_never_reexecutes(reason):
    calls = []
    llm = provider()
    armed = False

    def interrupt(run_id, boundary, checkpoint):
        return reason if armed else None

    runtime = ToolCallingRuntime(llm, registry(calls), interruption=interrupt)
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    armed = True
    interrupted = runtime.run((), model="test", run_id="run", resume_state=restore(waiting.checkpoint),
                              external_result=resolution())
    assert interrupted.status is RuntimeResultStatus.INTERRUPTED
    assert interrupted.checkpoint.external_operation_id == OPERATION
    assert calls == ["propose"]
    armed = False
    resumed = runtime.run((), model="test", run_id="run", resume_state=restore(interrupted.checkpoint),
                          resume_command=ResumeCommand(ResumeAction.CONTINUE))
    assert resumed.status.value == ("external_result_required" if reason == "paused" else "reconciliation_required")
    if reason == "paused":
        assert resumed.checkpoint.phase.value == "external_result_required"
        waiting_again = runtime.run((), model="test", run_id="run", resume_state=restore(resumed.checkpoint))
        assert waiting_again.status.value == "external_result_required"
    assert calls == ["propose"]
    assert len(llm.requests) == 1


def test_external_wait_does_not_reset_tool_budget():
    calls = []
    llm = provider()
    runtime = ToolCallingRuntime(llm, registry(calls))
    limits = RuntimeLimits(max_tool_calls=1)
    waiting = runtime.run(MESSAGES, model="test", run_id="run", limits=limits)
    result = runtime.run((), model="test", run_id="run", limits=limits,
                         resume_state=restore(waiting.checkpoint), external_result=resolution())
    assert result.status is RuntimeResultStatus.COMPLETED
    assert result.tool_attempts == 1
    assert calls == ["propose"]
    assert result.exhausted


@pytest.mark.parametrize("changes", [
    {"pending": None}, {"external_operation_id": None},
    {"completed_tool_call_ids": ("write-call",)},
])
def test_malformed_external_checkpoint_cannot_fall_through_to_model(changes):
    calls = []
    llm = provider()
    runtime = ToolCallingRuntime(llm, registry(calls))
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    malformed = replace(restore(waiting.checkpoint), **changes)
    result = runtime.run((), model="test", run_id="run", resume_state=malformed,
                         external_result=resolution())
    assert result.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert len(llm.requests) == 1



@pytest.mark.parametrize("boundary", ["checkpoint", "notification"])
def test_external_wait_durability_failure_never_runs_remaining_batch(boundary):
    class Store(InMemoryCheckpointStore):
        def save(self, checkpoint):
            if boundary == "checkpoint" and checkpoint.phase.value == "external_result_required":
                raise OSError("injected checkpoint failure")
            return super().save(checkpoint)

    class Tracer(InMemoryRunTracer):
        def emit(self, event):
            if boundary == "notification" and event.kind == "external_result_required":
                raise OSError("injected trace failure")
            return super().emit(event)

    calls = []
    llm = provider()
    store = Store()
    runtime = ToolCallingRuntime(llm, registry(calls), checkpoints=store, tracer=Tracer())
    result = runtime.run(MESSAGES, model="test", run_id="run")
    assert result.status is RuntimeResultStatus.FAILED
    assert result.error_code == "runtime_infrastructure"
    persisted = store.load("run")
    assert persisted.pending.call_id == "write-call"
    assert persisted.external_operation_id == OPERATION
    assert not any(m.role is MessageRole.TOOL for m in persisted.messages)
    assert calls == ["propose"] and len(llm.requests) == 1
    retried = runtime.run((), model="test", run_id="run", resume_state=restore(persisted),
                          external_result=resolution())
    assert retried.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert calls == ["propose"] and len(llm.requests) == 1


@pytest.mark.parametrize("operation_id", ["", "  ", None, 1])
def test_deferred_requires_nonempty_operation_identity(operation_id):
    with pytest.raises(ValueError):
        RuntimeToolResult.deferred(operation_id)


def test_external_result_cannot_itself_defer():
    with pytest.raises(ValueError, match="final"):
        resolution(result=RuntimeToolResult.deferred("again"))


@pytest.mark.parametrize("changes", [{"name": "read"}, {"arguments": {"unexpected": True}}, {"attempt": 0}])
def test_external_pending_must_match_the_original_assistant_call(changes):
    calls = []
    llm = provider()
    runtime = ToolCallingRuntime(llm, registry(calls))
    waiting = runtime.run(MESSAGES, model="test", run_id="run")
    checkpoint = replace(waiting.checkpoint, pending=replace(waiting.checkpoint.pending, **changes))
    result = runtime.run((), model="test", run_id="run", resume_state=checkpoint, external_result=resolution())
    assert result.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert calls == ["propose"] and len(llm.requests) == 1


def test_pure_checkpoint_resolution_prepares_feedback_without_dispatch_or_mutating_input():
    from app.platform.ai_sdk.runtime import JsonToolFeedbackFormatter, resolve_external_checkpoint

    calls = []
    llm = provider()
    tools = registry(calls)
    waiting = ToolCallingRuntime(llm, tools).run(MESSAGES, model="test", run_id="run")
    before = waiting.checkpoint.to_dict()
    resolved = resolve_external_checkpoint(waiting.checkpoint, resolution(), tool=tools.get("propose"),
                                           formatter=JsonToolFeedbackFormatter())
    assert waiting.checkpoint.to_dict() == before
    assert resolved.phase.value == "after_tool" and resolved.pending is None
    assert resolved.sequence == waiting.checkpoint.sequence + 1
    assert resolved.completed_tool_call_ids == ("write-call",)
    assert resolved.round_count == waiting.checkpoint.round_count
    assert resolved.tool_attempts == waiting.checkpoint.tool_attempts
    assert calls == ["propose"] and len(llm.requests) == 1
    with pytest.raises(ValueError, match="not_waiting"):
        resolve_external_checkpoint(resolved, resolution(), tool=tools.get("propose"), formatter=JsonToolFeedbackFormatter())


def test_pure_checkpoint_resolution_blocks_native_continuation_before_domain_can_publish():
    from app.platform.ai_sdk.runtime import JsonToolFeedbackFormatter, resolve_external_checkpoint

    calls = []
    tools = registry(calls)
    waiting = ToolCallingRuntime(provider(), tools).run(MESSAGES, model="test", run_id="run")
    cp = replace(waiting.checkpoint, continuation_omitted=True)
    with pytest.raises(ValueError, match="continuation_unavailable"):
        resolve_external_checkpoint(cp, resolution(), tool=tools.get("propose"), formatter=JsonToolFeedbackFormatter())
    assert calls == ["propose"]
