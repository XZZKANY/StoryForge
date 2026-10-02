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
from app.platform.ai_sdk.runtime.external_results import (
    consume_external_result,
    external_resolution_issue,
    external_wait_issue,
)
from app.platform.ai_sdk.runtime.feedback import (
    JsonToolFeedbackFormatter,
    ToolFeedbackFormatter,
    append_tool_feedback,
    parse_tool_arguments,
)
from app.platform.ai_sdk.runtime.models import (
    ExternalToolResolution,
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
        external_result: ExternalToolResolution | None = None,
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
        if external_result is not None and (resume_state is None or not state.external_operation_id):
            return self._reconciliation(state, "External result requires a waiting checkpoint.")
        try:
            if resume_state is None:
                self._emit(state, "runtime_started", critical=True)
            else:
                self._emit(state, "runtime_resumed", critical=True)
                resumed = self._resume(state, resume_command, application_context, active_limits, external_result)
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
        external_result: ExternalToolResolution | None,
    ) -> RuntimeResult | None:
        if state.continuation_omitted:
            return self._reconciliation(
                state, "Provider continuation was omitted from the serialized checkpoint."
            )
        if state.phase is RuntimePhase.INTERRUPTED:
            if command is None or command.action is not ResumeAction.CONTINUE:
                return self._pause_result(state)
            if state.interruption_reason == "stopped":
                return self._reconciliation(state, "Stopped execution cannot resume without reconciliation.")
            state.interruption_reason = None
        if state.phase is RuntimePhase.FAILED:
            return self._reconciliation(state, "Failed runtime requires explicit reconciliation.")
        resolved = set(state.completed_tool_call_ids) | {
            message.tool_call_id for message in state.messages if message.role is MessageRole.TOOL
        }
        active_index = next((index for index in range(len(state.messages) - 1, -1, -1)
                             if state.messages[index].role is MessageRole.ASSISTANT), -1)
        active_calls = state.messages[active_index].tool_calls if active_index >= 0 else ()
        if any(call.id not in resolved and (index != active_index or state.round_count == 0)
               for index, message in enumerate(state.messages) for call in message.tool_calls):
            return self._reconciliation(state, "Older tool-call history has an unknown outcome.")
        if state.pending is not None and state.pending.call_id not in {call.id for call in active_calls}:
            return self._reconciliation(state, "Pending tool does not belong to the current model batch.")
        if state.external_operation_id is not None or state.phase is RuntimePhase.EXTERNAL_RESULT_REQUIRED:
            issue = external_wait_issue(state)
            if issue is not None:
                return self._reconciliation(state, issue)
            if external_result is None:
                if state.phase is RuntimePhase.INTERRUPTED:
                    state.phase = RuntimePhase.EXTERNAL_RESULT_REQUIRED
                    self._save(state)
                return self._external_wait_result(state)
        if state.pending is not None:
            try:
                tool = self._tools.get(state.pending.name)
            except ToolRegistryError:
                return self._reconciliation(state, "Pending tool is no longer registered.")
            if state.external_operation_id is not None:
                assert external_result is not None
                issue = external_resolution_issue(state, external_result, tool)
                if issue is not None:
                    return self._reconciliation(state, issue)
                interruption = self._check_interruption(state, "before_external_result")
                if interruption is not None:
                    return interruption
                consume_external_result(state, external_result, tool=tool,
                                        formatter=self._feedback_formatter, context=application_context, limits=limits)
                self._emit(state, "tool_completed" if external_result.result.status is ToolResultStatus.SUCCESS
                           else "tool_failed", {"tool": tool.spec.name, "tool_call_id": external_result.tool_call_id})
                self._save(state)
            elif state.phase is RuntimePhase.APPROVAL_REQUIRED:
                if command is None:
                    return self._approval_result(state)
                if command.tool_call_id not in {None, state.pending.call_id}:
                    return self._failure(state, "approval_call_mismatch", "Approval targets another tool call.")
                if command.action is ResumeAction.DENY:
                    append_tool_feedback(
                        state,
                        ToolCall(state.pending.call_id, state.pending.name,
                                 json.dumps(thaw(state.pending.arguments), ensure_ascii=False)),
                        RuntimeToolResult.failure("approval_denied", "Tool execution was denied."),
                        formatter=self._feedback_formatter, tool=tool, context=application_context,
                    )
                    state.completed_tool_call_ids.append(state.pending.call_id)
                    state.pending = None
                    state.phase = RuntimePhase.AFTER_TOOL
                    self._save(state)
                elif command.action is not ResumeAction.APPROVE:
                    return self._approval_result(state)
                else:
                    result = self._execute_pending(state, tool, application_context, limits)
                    if result is not None:
                        return result
            elif state.phase is RuntimePhase.TOOL_STARTED or state.pending.attempt > 0:
                if not self._policy.can_resume_started_tool(tool, state.pending):
                    return self._reconciliation(
                        state, "Pending tool outcome is unknown and cannot be replayed safely."
                    )
                selected = {item.spec.name for item in self._selector.select(self._tools, application_context)}
                if tool.spec.name not in selected:
                    return self._reconciliation(state, "Pending tool is no longer available.")
                result = self._execute_pending(state, tool, application_context, limits)
                if result is not None:
                    return result
        # Model-completed checkpoints prove that these calls exist but were not
        # dispatched. Completed ids/results remain facts and are never replayed.
        resolved = set(state.completed_tool_call_ids) | {
            message.tool_call_id for message in state.messages if message.role is MessageRole.TOOL
        }
        calls = [call for call in active_calls if call.id not in resolved]
        for call in calls:
            selected = {item.spec.name for item in self._selector.select(self._tools, application_context)}
            result = self._prepare_and_execute_call(state, call, selected, application_context, limits)
            if result is not None:
                return result
        if (state.round_count > 0 and state.messages and state.messages[-1].role is MessageRole.ASSISTANT
                and not state.messages[-1].tool_calls):
            return self._complete(state, state.messages[-1].content or "")
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
            reason = self._interruption_reason(state, "before_model_dispatch")
            if reason is not None:
                # The trace marks dispatch intent, not a provider request that happened.
                state.round_count -= 1
                return self._interrupt(state, reason)
            try:
                response = self._llm.complete(
                    ChatRequest(model=state.model, messages=tuple(state.messages), tools=offered)
                )
            except ProviderError as exc:
                if exc.usage is not None:
                    self._record_usage(state, exc.usage)
                interruption = self._check_interruption(state, "model_error")
                if interruption is not None:
                    return interruption
                return self._failure(
                    state,
                    f"provider_{exc.details.category.value}",
                    exc.details.safe_message,
                )
            except Exception as exc:  # noqa: BLE001 - external adapters may signal interruption outside ProviderError
                usage = getattr(exc, "usage", None)
                if isinstance(usage, TokenUsage):
                    self._record_usage(state, usage)
                interruption = self._check_interruption(state, "model_error")
                if interruption is not None:
                    return interruption
                raise
            state.phase = RuntimePhase.MODEL_COMPLETED
            self._record_usage(state, response.usage)
            self._emit(
                state,
                "model_completed",
                {"tool_call_count": len(response.tool_calls), "finish_reason": response.finish_reason},
            )
            # Preserve only complete model output. Cancellation still observes real usage
            # for truncated/filtered responses without leaking them into resumable history.
            if response.finish_reason not in {"length", "content_filter"}:
                state.messages.append(response.to_assistant_message())
                if response.tool_calls:
                    self._save(state)
            interruption = self._check_interruption(state, "after_model")
            if interruption is not None:
                return interruption
            if response.finish_reason == "length":
                # Even valid JSON can belong to an incomplete model response. Keep usage,
                # but never execute its calls or put partial output into future context.
                return self._failure(
                    state,
                    "model_output_truncated",
                    "Model output reached its limit before completion; no returned tool calls were executed.",
                )
            if response.finish_reason == "content_filter":
                return self._failure(
                    state, "provider_content_filter", "Provider filtered the response; no returned tool calls were executed.",
                )
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
        interruption = self._check_interruption(state, "before_tool_dispatch")
        if interruption is not None:
            return interruption
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
        interruption = self._check_interruption(state, "after_tool_policy")
        if interruption is not None:
            return interruption
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
            interruption = self._check_interruption(state, "after_approval_checkpoint")
            if interruption is not None:
                return interruption
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
        result: RuntimeToolResult | None = None
        interruption_reason: str | None = None
        while True:
            interruption_reason = self._interruption_reason(state, "before_tool_attempt")
            if interruption_reason is not None:
                if result is None:
                    return self._interrupt(state, interruption_reason)
                break
            if should_withdraw_tools(state, limits):
                state.exhausted = True
                # A returned failure is a fact; do not replace it with a retry-budget rejection.
                if result is None:
                    if state.tool_attempts >= limits.max_tool_calls:
                        result = RuntimeToolResult.failure("tool_call_budget", "Tool-call budget is exhausted.")
                    else:
                        result = RuntimeToolResult.failure("runtime_budget", "Runtime budget is exhausted.")
                break
            previous_pending = pending
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
            interruption_reason = self._interruption_reason(state, "before_tool_dispatch")
            if interruption_reason is not None:
                # No handler ran: undo the reserved attempt while retaining unresolved intent.
                state.tool_attempts -= 1
                state.pending = pending = previous_pending
                if result is None:
                    return self._interrupt(state, interruption_reason)
                break
            try:
                result = tool.handler(application_context, thaw(pending.arguments))
            except Exception:  # noqa: BLE001 - adapters normalize expected failures; runtime hides raw exceptions
                interruption = self._check_interruption(state, "tool_error")
                if interruption is not None:
                    # A handler that raised on cancellation has no known outcome. Keep pending.
                    return interruption
                result = RuntimeToolResult.failure(
                    "tool_exception", "Tool execution failed with an unhandled exception."
                )
            if result.status is ToolResultStatus.DEFERRED:
                state.external_operation_id = result.external_operation_id
                state.artifacts.extend(result.artifacts)
                if state.checkpoint().to_dict()["continuation_omitted"]:
                    state.continuation_omitted = True
                    state.phase = RuntimePhase.INTERRUPTED
                    state.interruption_reason = "provider_continuation_unavailable"
                    self._save(state)
                    return self._reconciliation(state, "Provider continuation cannot survive external waiting.")
                state.phase = RuntimePhase.EXTERNAL_RESULT_REQUIRED
                self._save(state)
                interruption = self._check_interruption(state, "after_external_checkpoint")
                if interruption is not None:
                    return interruption
                self._emit(state, "external_result_required",
                           {"tool": tool.spec.name, "tool_call_id": pending.call_id}, critical=True)
                self._save(state)
                return self._external_wait_result(state)
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
            interruption_reason = self._interruption_reason(state, "after_tool")
            if interruption_reason is not None:
                break
            if not self._policy.should_retry(tool, result.retryable, attempt):
                break
        assert result is not None
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
        if interruption_reason is not None:
            return self._interrupt(state, interruption_reason)
        return self._check_interruption(state, "after_tool")

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
        return self._check_interruption(state, "after_tool")

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

    def _interruption_reason(self, state: RuntimeState, boundary: str) -> str | None:
        if self._interruption is None:
            return None
        return self._interruption(state.run_id, boundary, state.checkpoint())

    def _check_interruption(self, state: RuntimeState, boundary: str | None = None) -> RuntimeResult | None:
        reason = self._interruption_reason(state, boundary or f"before_round:{state.round_count + 1}")
        if reason is None:
            return None
        return self._interrupt(state, reason)

    def _interrupt(self, state: RuntimeState, reason: str) -> RuntimeResult:
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

    def _external_wait_result(self, state: RuntimeState) -> RuntimeResult:
        return self._result(
            state, RuntimeResultStatus.EXTERNAL_RESULT_REQUIRED, checkpoint=state.checkpoint(),
            pending_tool_call_id=state.pending.call_id if state.pending else None,
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
