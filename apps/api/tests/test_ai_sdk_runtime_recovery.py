from __future__ import annotations

import json
from dataclasses import replace

from app.platform.ai_sdk import (
    ChatMessage,
    ChatResponse,
    MessageRole,
    ProviderContinuation,
    ToolCall,
    ToolSpec,
)
from app.platform.ai_sdk.providers import DeterministicProvider
from app.platform.ai_sdk.runtime import (
    InMemoryCheckpointStore,
    ResumeAction,
    ResumeCommand,
    RuntimeCheckpoint,
    RuntimeLimits,
    RuntimePhase,
    RuntimeResultStatus,
    ToolCallingRuntime,
)
from app.platform.ai_sdk.tools import RuntimeTool, RuntimeToolResult, ToolRegistry

MESSAGES = (ChatMessage(MessageRole.USER, "change"),)


def _approval_registry(*, idempotent: bool = True, calls: list[str] | None = None) -> ToolRegistry:
    def handler(context, arguments):
        if calls is not None:
            calls.append(arguments["value"])
        return RuntimeToolResult.success({"changed": True})

    return ToolRegistry(
        [
            RuntimeTool(
                spec=ToolSpec(
                    "change",
                    "Change",
                    {
                        "type": "object",
                        "properties": {"value": {"type": "string"}},
                        "required": ["value"],
                    },
                ),
                handler=handler,
                requires_approval=True,
                retry_safe=idempotent,
                idempotent=idempotent,
            )
        ]
    )


def test_approval_checkpoint_json_round_trip_and_resume() -> None:
    calls: list[str] = []
    store = InMemoryCheckpointStore()
    provider = DeterministicProvider(
        responses=[
            ChatResponse("", tool_calls=(ToolCall("call-1", "change", '{"value":"x"}'),)),
            ChatResponse("done"),
        ]
    )
    runtime = ToolCallingRuntime(provider, _approval_registry(calls=calls), checkpoints=store)
    pending = runtime.run(
        MESSAGES, model="deterministic", run_id="run-approval", limits=RuntimeLimits(max_rounds=3)
    )
    assert pending.status is RuntimeResultStatus.APPROVAL_REQUIRED
    assert pending.checkpoint is not None
    stored = store.load("run-approval")
    assert stored is not None
    assert stored.sequence == pending.checkpoint.sequence
    serialized = stored.to_dict()
    json.dumps(serialized)
    restored = pending.checkpoint.from_dict(serialized)
    resumed = runtime.run(
        (),
        model="deterministic",
        run_id="run-approval",
        limits=RuntimeLimits(max_rounds=3),
        resume_state=restored,
        resume_command=ResumeCommand(ResumeAction.APPROVE, tool_call_id="call-1"),
    )
    assert resumed.status is RuntimeResultStatus.COMPLETED
    assert resumed.content == "done"
    assert calls == ["x"]


def test_interruption_occurs_only_at_round_boundary_and_can_resume() -> None:
    checks = 0

    def interrupt(run_id, boundary, state):
        nonlocal checks
        checks += 1
        return "paused" if checks == 1 else None

    provider = DeterministicProvider(responses=[ChatResponse("done")])
    runtime = ToolCallingRuntime(provider, ToolRegistry(), interruption=interrupt)
    interrupted = runtime.run(MESSAGES, model="deterministic", run_id="run-interrupt")
    assert interrupted.status is RuntimeResultStatus.INTERRUPTED
    assert provider.requests == []
    resumed = runtime.run(
        (),
        model="deterministic",
        run_id="run-interrupt",
        resume_state=interrupted.checkpoint,
        resume_command=ResumeCommand(ResumeAction.CONTINUE),
    )
    assert resumed.content == "done"


def test_non_idempotent_started_tool_requires_reconciliation_instead_of_replay() -> None:
    calls: list[str] = []
    provider = DeterministicProvider(
        responses=[ChatResponse("", tool_calls=(ToolCall("call-1", "change", '{"value":"x"}'),))]
    )
    runtime = ToolCallingRuntime(provider, _approval_registry(idempotent=False, calls=calls))
    approval = runtime.run(MESSAGES, model="deterministic", run_id="run-reconcile")
    assert approval.checkpoint is not None
    crashed = replace(approval.checkpoint, phase=RuntimePhase.TOOL_STARTED)
    resumed = runtime.run(
        (), model="deterministic", run_id="run-reconcile", resume_state=crashed
    )
    assert resumed.status is RuntimeResultStatus.RECONCILIATION_REQUIRED
    assert resumed.pending_tool_call_id == "call-1"
    assert calls == []


def test_idempotent_started_tool_can_resume_once_under_policy() -> None:
    calls: list[str] = []
    provider = DeterministicProvider(
        responses=[
            ChatResponse("", tool_calls=(ToolCall("call-1", "change", '{"value":"x"}'),)),
            ChatResponse("done"),
        ]
    )
    runtime = ToolCallingRuntime(provider, _approval_registry(calls=calls))
    approval = runtime.run(MESSAGES, model="deterministic", run_id="run-idempotent")
    assert approval.checkpoint is not None
    crashed = replace(approval.checkpoint, phase=RuntimePhase.TOOL_STARTED)
    resumed = runtime.run(
        (), model="deterministic", run_id="run-idempotent", resume_state=crashed
    )
    assert resumed.status is RuntimeResultStatus.COMPLETED
    assert resumed.content == "done"
    assert calls == ["x"]


def test_critical_checkpoint_failure_returns_terminal_runtime_failure() -> None:
    class FailingCheckpointStore:
        def save(self, checkpoint):
            raise RuntimeError("storage offline")

        def load(self, run_id):
            return None

    result = ToolCallingRuntime(
        DeterministicProvider(responses=[ChatResponse("done")]),
        ToolRegistry(),
        checkpoints=FailingCheckpointStore(),
    ).run(MESSAGES, model="deterministic", run_id="run-checkpoint-failure")
    assert result.status is RuntimeResultStatus.FAILED
    assert result.error_code == "runtime_infrastructure"
    assert result.error_message == "Checkpoint store failed."


def test_serialized_provider_continuation_requires_reconciliation() -> None:
    provider = DeterministicProvider(responses=[])
    runtime = ToolCallingRuntime(provider, ToolRegistry())
    serialized = RuntimeCheckpoint(
        run_id="run-continuation",
        model="deterministic",
        phase=RuntimePhase.INTERRUPTED,
        messages=(
            ChatMessage(
                MessageRole.ASSISTANT,
                tool_calls=(ToolCall("call-1", "change", "{}"),),
                continuation=ProviderContinuation("test", {"opaque": "state"}),
            ),
        ),
    ).to_dict()
    restored = RuntimeCheckpoint.from_dict(serialized)
    result = runtime.run(
        (),
        model="deterministic",
        run_id="run-continuation",
        resume_state=restored,
        resume_command=ResumeCommand(ResumeAction.CONTINUE),
    )
    assert result.status is RuntimeResultStatus.RECONCILIATION_REQUIRED


def test_trace_reliability_distinguishes_diagnostic_and_terminal_events() -> None:
    class SelectiveTracer:
        def __init__(self, failing_kind: str) -> None:
            self.failing_kind = failing_kind

        def emit(self, event) -> None:
            if event.kind == self.failing_kind:
                raise RuntimeError("trace offline")

    diagnostic = ToolCallingRuntime(
        DeterministicProvider(responses=[ChatResponse("done")]),
        ToolRegistry(),
        tracer=SelectiveTracer("model_started"),
    ).run(MESSAGES, model="deterministic", run_id="run-diagnostic-trace")
    assert diagnostic.status is RuntimeResultStatus.COMPLETED

    store = InMemoryCheckpointStore()
    terminal = ToolCallingRuntime(
        DeterministicProvider(responses=[ChatResponse("done")]),
        ToolRegistry(),
        tracer=SelectiveTracer("runtime_completed"),
        checkpoints=store,
    ).run(MESSAGES, model="deterministic", run_id="run-terminal-trace")
    assert terminal.status is RuntimeResultStatus.FAILED
    assert terminal.error_code == "runtime_infrastructure"
    stored = store.load("run-terminal-trace")
    assert stored is not None
    assert stored.phase is RuntimePhase.FAILED
