from __future__ import annotations

import json
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from app.platform.ai_sdk._immutability import thaw
from app.platform.ai_sdk.contracts import ChatMessage, ChatRequest, MessageRole, TokenUsage, ToolCall
from app.platform.ai_sdk.errors import ProviderError
from app.platform.ai_sdk.observability import (
    NullRunTracer,
    NullUsageSink,
    RuntimeTraceEvent,
    RunTracer,
    UsageSink,
)
from app.platform.ai_sdk.provider import LLMProvider
from app.platform.ai_sdk.runtime.budget import should_withdraw_tools
from app.platform.ai_sdk.runtime.feedback import (
    JsonToolFeedbackFormatter,
    ToolFeedbackFormatter,
    append_tool_feedback,
    parse_tool_arguments,
)
from app.platform.ai_sdk.runtime.models import (
    PendingToolCall,
    ResumeAction,
    ResumeCommand,
    RuntimeCheckpoint,
    RuntimeLimits,
    RuntimePhase,
    RuntimeResult,
    RuntimeResultStatus,
)
from app.platform.ai_sdk.runtime.ports import (
    AllToolsSelector,
    CheckpointStore,
    DefaultRuntimePolicy,
    InMemoryCheckpointStore,
    InterruptionCheck,
    PolicyDecisionKind,
    RuntimePolicy,
    ToolSelector,
)
from app.platform.ai_sdk.runtime.state import RuntimeState
from app.platform.ai_sdk.tools import (
    RuntimeTool,
    RuntimeToolResult,
    ToolRegistry,
    ToolRegistryError,
    ToolResultStatus,
    validate_json_schema,
)


class RuntimeInfrastructureError(RuntimeError):
    pass


class ToolCallingRuntime:
    def __init__(
        self,
        llm: LLMProvider,
        tools: ToolRegistry,
        *,
        policy: RuntimePolicy | None = None,
        selector: ToolSelector | None = None,
        tracer: RunTracer | None = None,
        usage_sink: UsageSink | None = None,
        checkpoints: CheckpointStore | None = None,
        interruption: InterruptionCheck | None = None,
        feedback_formatter: ToolFeedbackFormatter | None = None,
        diagnostic_trace_best_effort: bool = True,
    ) -> None:
        self._llm = llm
        self._tools = tools
        self._policy = policy or DefaultRuntimePolicy()
        self._selector = selector or AllToolsSelector()
        self._tracer = tracer or NullRunTracer()
        self._usage_sink = usage_sink or NullUsageSink()
        self._checkpoints = checkpoints or InMemoryCheckpointStore()
        self._interruption = interruption
        self._feedback_formatter = feedback_formatter or JsonToolFeedbackFormatter()
        self._diagnostic_trace_best_effort = diagnostic_trace_best_effort

    def run(
        self,
        messages: tuple[ChatMessage, ...] | list[ChatMessage],
        *,
        model: str,
        run_id: str,
        limits: RuntimeLimits | None = None,
        application_context: Any = None,
        resume_state: RuntimeCheckpoint | None = None,
        resume_command: ResumeCommand | None = None,
    ) -> RuntimeResult:
        active_limits = limits or RuntimeLimits()
        state = (
            RuntimeState.from_checkpoint(resume_state)
            if resume_state is not None
            else RuntimeState(run_id, model, RuntimePhase.BEFORE_MODEL, list(messages))
        )
        if state.run_id != run_id or state.model != model:
            return self._failure(
                state,
                "resume_identity_mismatch",
                "Checkpoint identity does not match the run.",
                record=False,
            )
        try:
            if resume_state is None:
                self._emit(state, "runtime_started", critical=True)
            else:
                self._emit(state, "runtime_resumed", critical=True)
                resumed = self._resume(state, resume_command, application_context, active_limits)
                if resumed is not None:
                    return resumed
            return self._run_loop(state, active_limits, application_context)
        except RuntimeInfrastructureError as exc:
            return self._failure(state, "runtime_infrastructure", str(exc), record=False)

    def _resume(
        self,
        state: RuntimeState,
        command: ResumeCommand | None,
        application_context: Any,
        limits: RuntimeLimits,
    ) -> RuntimeResult | None:
        if state.continuation_omitted:
            return self._reconciliation(
                state, "Provider continuation was omitted from the serialized checkpoint."
            )
        if state.phase is RuntimePhase.INTERRUPTED:
            if command is None or command.action is not ResumeAction.CONTINUE:
                return self._pause_result(state)
            state.phase = RuntimePhase.BEFORE_MODEL
            state.interruption_reason = None
            return None
        if state.pending is None:
            state.phase = RuntimePhase.BEFORE_MODEL
            return None
        try:
            tool = self._tools.get(state.pending.name)
        except ToolRegistryError:
            return self._reconciliation(state, "Pending tool is no longer registered.")
        if state.phase is RuntimePhase.APPROVAL_REQUIRED:
            if command is None:
                return self._approval_result(state)
            if command.tool_call_id not in {None, state.pending.call_id}:
                return self._failure(state, "approval_call_mismatch", "Approval targets another tool call.")
            if command.action is ResumeAction.DENY:
                append_tool_feedback(
                    state,
                    ToolCall(
                        state.pending.call_id,
                        state.pending.name,
                        json.dumps(thaw(state.pending.arguments), ensure_ascii=False),
                    ),
                    RuntimeToolResult.failure("approval_denied", "Tool execution was denied."),
                    formatter=self._feedback_formatter,
                    tool=tool,
                    context=application_context,
                )
                state.pending = None
                state.phase = RuntimePhase.AFTER_TOOL
                self._save(state)
                return None
            if command.action is not ResumeAction.APPROVE:
                return self._approval_result(state)
            return self._execute_pending(state, tool, application_context, limits)
        if state.phase is RuntimePhase.TOOL_STARTED:
            if not self._policy.can_resume_started_tool(tool, state.pending):
                return self._reconciliation(
                    state, "Pending tool may have produced a side effect and cannot be replayed safely."
                )
            return self._execute_pending(state, tool, application_context, limits)
        state.phase = RuntimePhase.BEFORE_MODEL
        return None

    def _run_loop(
        self, state: RuntimeState, limits: RuntimeLimits, application_context: Any
    ) -> RuntimeResult:
        while state.round_count < limits.max_rounds:
            interruption = self._check_interruption(state)
            if interruption is not None:
                return interruption
            selected = self._selector.select(self._tools, application_context)
            withdraw_tools = should_withdraw_tools(state, limits)
            if withdraw_tools:
                state.exhausted = True
            if state.round_count + 1 >= limits.max_rounds:
                withdraw_tools = True
                state.exhausted = True
            if withdraw_tools and (
                not state.messages
                or state.messages[-1].role is not MessageRole.SYSTEM
                or state.messages[-1].content != limits.final_message
            ):
                state.messages.append(ChatMessage(MessageRole.SYSTEM, limits.final_message))
            offered = () if withdraw_tools else tuple(tool.spec for tool in selected)
            state.round_count += 1
            state.phase = RuntimePhase.BEFORE_MODEL
            self._emit(state, "model_started", {"tools_offered": len(offered)})
            try:
                response = self._llm.complete(
                    ChatRequest(model=state.model, messages=tuple(state.messages), tools=offered)
                )
            except ProviderError as exc:
                return self._failure(
                    state,
                    f"provider_{exc.details.category.value}",
                    exc.details.safe_message,
                )
            state.phase = RuntimePhase.MODEL_COMPLETED
            self._record_usage(state, response.usage)
            self._emit(
                state,
                "model_completed",
                {"tool_call_count": len(response.tool_calls), "finish_reason": response.finish_reason},
            )
            state.messages.append(response.to_assistant_message())
            if not response.tool_calls:
                return self._complete(state, response.content)
            if withdraw_tools:
                return self._failure(
                    state,
                    "tool_call_after_withdrawal",
                    "Provider returned a tool call after tools were withdrawn.",
                )
            state.phase = RuntimePhase.TOOLS_PENDING
            selected_names = {tool.spec.name for tool in selected}
            for call in response.tool_calls:
                paused = self._prepare_and_execute_call(
                    state, call, selected_names, application_context, limits
                )
                if paused is not None:
                    return paused
            state.phase = RuntimePhase.AFTER_TOOL
        return self._failure(state, "round_limit", "Runtime reached its round limit.")

    def _prepare_and_execute_call(
        self,
        state: RuntimeState,
        call: ToolCall,
        selected_names: set[str],
        application_context: Any,
        limits: RuntimeLimits,
    ) -> RuntimeResult | None:
        if call.id in state.completed_tool_call_ids:
            return None
        try:
            tool = self._tools.get(call.name)
        except ToolRegistryError:
            result = RuntimeToolResult.failure("unknown_tool", f"Unknown runtime tool: {call.name}")
            return self._reject_call(
                state,
                call,
                result,
                application_context=application_context,
            )
        if call.name not in selected_names:
            result = RuntimeToolResult.failure(
                "tool_not_available", "Tool is not available in the current runtime selection."
            )
            return self._reject_call(
                state,
                call,
                result,
                tool=tool,
                application_context=application_context,
            )
        arguments, failure = parse_tool_arguments(call, tool)
        if failure is not None:
            return self._reject_call(
                state,
                call,
                failure,
                tool=tool,
                application_context=application_context,
            )
        assert arguments is not None
        if should_withdraw_tools(state, limits):
            state.exhausted = True
            result = RuntimeToolResult.failure(
                "runtime_budget", "Runtime budget is exhausted before tool execution."
            )
            return self._reject_call(
                state,
                call,
                result,
                tool=tool,
                application_context=application_context,
            )
        state.pending = PendingToolCall(call.id, call.name, arguments)
        decision = self._policy.decide_tool(tool, state.pending, application_context)
        if decision.kind is PolicyDecisionKind.DENY:
            result = RuntimeToolResult.failure("policy_denied", decision.reason or "Tool denied by policy.")
            state.pending = None
            return self._reject_call(
                state,
                call,
                result,
                tool=tool,
                application_context=application_context,
            )
        if decision.kind is PolicyDecisionKind.REQUIRE_APPROVAL:
            state.phase = RuntimePhase.APPROVAL_REQUIRED
            self._emit(
                state,
                "approval_required",
                {"tool": call.name, "tool_call_id": call.id, "reason": decision.reason},
                critical=True,
            )
            self._save(state)
            return self._approval_result(state)
        return self._execute_pending(state, tool, application_context, limits)

    def _execute_pending(
        self,
        state: RuntimeState,
        tool: RuntimeTool,
        application_context: Any,
        limits: RuntimeLimits,
    ) -> RuntimeResult | None:
        pending = state.pending
        if pending is None:
            return self._failure(state, "missing_pending_tool", "Runtime has no pending tool call.")
        result: RuntimeToolResult
        while True:
            if state.tool_attempts >= limits.max_tool_calls:
                state.exhausted = True
                result = RuntimeToolResult.failure("tool_call_budget", "Tool-call budget is exhausted.")
                break
            attempt = pending.attempt + 1
            pending = PendingToolCall(pending.call_id, pending.name, pending.arguments, attempt)
            state.pending = pending
            state.tool_attempts += 1
            state.phase = RuntimePhase.TOOL_STARTED
            self._emit(
                state,
                "tool_started",
                {"tool": tool.spec.name, "tool_call_id": pending.call_id, "attempt": attempt},
            )
            self._save(state)
            try:
                result = tool.handler(application_context, thaw(pending.arguments))
            except Exception:  # noqa: BLE001 - adapters normalize expected failures; runtime hides raw exceptions
                result = RuntimeToolResult.failure(
                    "tool_exception", "Tool execution failed with an unhandled exception."
                )
            if result.status is ToolResultStatus.SUCCESS and tool.output_schema:
                output_issues = validate_json_schema(result.output, tool.output_schema)
                if output_issues:
                    result = RuntimeToolResult.failure(
                        "invalid_tool_output", "Tool output does not match its declared schema."
                    )
            if result.status is ToolResultStatus.SUCCESS:
                break
            self._emit(
                state,
                "tool_failed",
                {
                    "tool": tool.spec.name,
                    "tool_call_id": pending.call_id,
                    "attempt": attempt,
                    "code": result.error_code,
                },
            )
            if not self._policy.should_retry(tool, result.retryable, attempt):
                break
        if result.status is ToolResultStatus.SUCCESS:
            state.artifacts.extend(result.artifacts)
            self._emit(
                state,
                "tool_completed",
                {"tool": tool.spec.name, "tool_call_id": pending.call_id, "attempt": pending.attempt},
            )
        state.completed_tool_call_ids.append(pending.call_id)
        append_tool_feedback(
            state,
            ToolCall(
                pending.call_id,
                pending.name,
                json.dumps(thaw(pending.arguments), ensure_ascii=False),
            ),
            result,
            formatter=self._feedback_formatter,
            tool=tool,
            context=application_context,
            limits=limits,
        )
        state.pending = None
        state.phase = RuntimePhase.AFTER_TOOL
        self._save(state)
        return None

    def _reject_call(
        self,
        state: RuntimeState,
        call: ToolCall,
        result: RuntimeToolResult,
        *,
        tool: RuntimeTool | None = None,
        application_context: Any = None,
    ) -> RuntimeResult | None:
        append_tool_feedback(
            state,
            call,
            result,
            formatter=self._feedback_formatter,
            tool=tool,
            context=application_context,
        )
        state.completed_tool_call_ids.append(call.id)
        state.phase = RuntimePhase.AFTER_TOOL
        self._emit(
            state,
            "tool_failed",
            {"tool": call.name, "tool_call_id": call.id, "code": result.error_code},
        )
        self._save(state)
        return None

    def _record_usage(self, state: RuntimeState, usage: TokenUsage) -> None:
        if usage.source != "unavailable":
            state.usage_available = True
            state.total_tokens += usage.total_tokens
        try:
            charge = self._usage_sink.record(state.run_id, state.round_count, usage)
        except Exception as exc:  # noqa: BLE001 - usage accounting is a budget-critical injected port
            raise RuntimeInfrastructureError("Usage sink failed.") from exc
        if charge is not None:
            state.cost_available = True
            state.total_cost = (state.total_cost or 0.0) + charge

    def _check_interruption(self, state: RuntimeState) -> RuntimeResult | None:
        if self._interruption is None:
            return None
        reason = self._interruption(state.run_id, f"before_round:{state.round_count + 1}", state.checkpoint())
        if reason is None:
            return None
        state.phase = RuntimePhase.INTERRUPTED
        state.interruption_reason = reason
        self._emit(state, "runtime_interrupted", {"reason": reason}, critical=True)
        self._save(state)
        return self._pause_result(state)

    def _save(self, state: RuntimeState) -> None:
        try:
            self._checkpoints.save(state.checkpoint())
        except Exception as exc:  # noqa: BLE001 - checkpoint durability is a critical port
            raise RuntimeInfrastructureError("Checkpoint store failed.") from exc
        self._emit(
            state,
            "checkpoint_saved",
            {"phase": state.phase.value},
            critical=True,
        )
        try:
            self._checkpoints.save(state.checkpoint())
        except Exception as exc:  # noqa: BLE001 - persist the trace sequence used for deterministic resume
            raise RuntimeInfrastructureError("Checkpoint store failed after trace emission.") from exc

    def _emit(
        self,
        state: RuntimeState,
        kind: str,
        payload: dict[str, Any] | None = None,
        *,
        critical: bool = False,
    ) -> None:
        state.sequence += 1
        event = RuntimeTraceEvent(
            state.run_id,
            state.sequence,
            state.round_count,
            datetime.now(UTC).isoformat(),
            kind,
            payload or {},
        )
        try:
            self._tracer.emit(event)
        except Exception as exc:  # noqa: BLE001 - trace reliability is configurable by event criticality
            if critical or not self._diagnostic_trace_best_effort:
                raise RuntimeInfrastructureError(f"Critical trace event failed: {kind}.") from exc

    def _complete(self, state: RuntimeState, content: str) -> RuntimeResult:
        state.phase = RuntimePhase.COMPLETED
        self._save(state)
        self._emit(state, "runtime_completed", {"exhausted": state.exhausted}, critical=True)
        return self._result(state, RuntimeResultStatus.COMPLETED, content=content)

    def _failure(
        self,
        state: RuntimeState,
        code: str,
        message: str,
        *,
        record: bool = True,
    ) -> RuntimeResult:
        state.phase = RuntimePhase.FAILED
        if record:
            self._save(state)
            self._emit(state, "runtime_failed", {"code": code}, critical=True)
        else:
            with suppress(Exception):
                self._checkpoints.save(state.checkpoint())
        return self._result(
            state,
            RuntimeResultStatus.FAILED,
            error_code=code,
            error_message=message,
        )

    def _approval_result(self, state: RuntimeState) -> RuntimeResult:
        return self._result(
            state,
            RuntimeResultStatus.APPROVAL_REQUIRED,
            checkpoint=state.checkpoint(),
            pending_tool_call_id=state.pending.call_id if state.pending else None,
        )

    def _pause_result(self, state: RuntimeState) -> RuntimeResult:
        return self._result(
            state,
            RuntimeResultStatus.INTERRUPTED,
            checkpoint=state.checkpoint(),
        )

    def _reconciliation(self, state: RuntimeState, message: str) -> RuntimeResult:
        return self._result(
            state,
            RuntimeResultStatus.RECONCILIATION_REQUIRED,
            error_code="reconciliation_required",
            error_message=message,
            checkpoint=state.checkpoint(),
            pending_tool_call_id=state.pending.call_id if state.pending else None,
        )

    @staticmethod
    def _result(
        state: RuntimeState,
        status: RuntimeResultStatus,
        *,
        content: str = "",
        error_code: str | None = None,
        error_message: str | None = None,
        checkpoint: RuntimeCheckpoint | None = None,
        pending_tool_call_id: str | None = None,
    ) -> RuntimeResult:
        return RuntimeResult(
            status,
            state.run_id,
            content=content,
            messages=tuple(state.messages),
            artifacts=tuple(state.artifacts),
            total_tokens=state.total_tokens,
            total_cost=state.total_cost,
            usage_available=state.usage_available,
            cost_available=state.cost_available,
            tool_attempts=state.tool_attempts,
            exhausted=state.exhausted,
            error_code=error_code,
            error_message=error_message,
            checkpoint=checkpoint,
            pending_tool_call_id=pending_tool_call_id,
        )
