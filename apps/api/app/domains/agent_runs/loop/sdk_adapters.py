from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from app.common.llm_client import cost_breakdown
from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
from app.domains.agent_runs.loop.support import (
    merge_cost_breakdown,
    review_feedback,
    revise_feedback,
    serialize_tool_output,
    tool_output_summary,
)
from app.domains.agent_runs.loop.types import LoopToolFeedback
from app.domains.agent_runs.tools import (
    list_loop_tool_specs,
    llm_tool_name,
    loop_patch_tool_specs,
)
from app.domains.agent_runs.tools.runtime_arguments import (
    HANDLER_OWNED_TRACE_TOOL_NAMES,
    sanitize_loop_tool_arguments,
)
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantToolCallCreate, AssistantToolCallUpdate
from app.platform.ai_sdk import (
    ChatRequest,
    ChatResponse,
    LLMProvider,
    ProviderCapabilities,
    ProviderHealth,
    RuntimeArtifact,
    RuntimeCheckpoint,
    RuntimeTool,
    RuntimeToolResult,
    TokenUsage,
    ToolCall,
    ToolRegistry,
    ToolSpec,
)
from app.platform.ai_sdk.observability import RuntimeTraceEvent
from app.platform.ai_sdk.runtime import PolicyDecision, PolicyDecisionKind

_PATCH_TOOL_NAMES = frozenset(spec.name for spec in loop_patch_tool_specs())
_LLM_TO_REGISTRY = {
    llm_tool_name(spec.name): spec.name for spec in list_loop_tool_specs()
}
_SINGLE_PATCH_ERROR = "一次对话最多生成一个待确认补丁：请先等作者处理当前补丁，再发起新的修订或起草。"
_PRE_HANDLER_FAILURE_CODES = frozenset(
    {
        "invalid_arguments",
        "policy_denied",
        "runtime_budget",
        "tool_call_budget",
        "tool_not_available",
        "unknown_tool",
    }
)
class StoryForgeProviderAdapter:
    def __init__(self, provider: LLMProvider, context: StoryForgeRuntimeContext) -> None:
        self._provider = provider
        self._context = context

    def complete(self, request: ChatRequest) -> ChatResponse:
        self._context.provider_attempts += 1
        response = self._context.remember_response(self._provider.complete(request))
        usage_payload = response.usage.to_legacy()
        raw_breakdown = response.metadata.get("cost_breakdown")
        breakdown = (
            dict(raw_breakdown)
            if isinstance(raw_breakdown, Mapping)
            else cost_breakdown(self._context.source, usage_payload)
        )
        raw_cost = response.metadata.get("cost_cny_estimated")
        estimated_cost = (
            float(raw_cost)
            if isinstance(raw_cost, int | float) and not isinstance(raw_cost, bool)
            else float(breakdown.get("total_cny") or 0.0)
        )
        self._context.pending_costs.append((estimated_cost, breakdown))
        return response

    def stream(self, request: ChatRequest):
        return self._provider.stream(request)

    def health(self) -> ProviderHealth:
        return self._provider.health()

    def capabilities(self, model: str) -> ProviderCapabilities:
        return self._provider.capabilities(model)


class StoryForgeUsageSink:
    def __init__(self, context: StoryForgeRuntimeContext) -> None:
        self._context = context

    def record(self, run_id: str, round_number: int, usage: TokenUsage) -> float | None:
        del run_id, round_number
        outcome = self._context.outcome
        outcome.prompt_tokens += usage.input_tokens
        outcome.completion_tokens += usage.output_tokens
        outcome.token_usage += usage.total_tokens
        if usage.source != "unavailable":
            if outcome.token_usage_source == "unavailable":
                outcome.token_usage_source = usage.source
            elif outcome.token_usage_source != usage.source:
                outcome.token_usage_source = "mixed"
        estimated_cost, breakdown = self._context.pending_costs.popleft()
        outcome.cost_cny_estimated += estimated_cost
        outcome.cost_breakdown = merge_cost_breakdown(
            outcome.cost_breakdown,
            breakdown,
            prompt_tokens=outcome.prompt_tokens,
            completion_tokens=outcome.completion_tokens,
            token_usage_source=outcome.token_usage_source,
        )
        return estimated_cost


class StoryForgeRuntimePolicy:
    def __init__(self, context: StoryForgeRuntimeContext) -> None:
        self._context = context

    def decide_tool(self, tool: RuntimeTool, call, context: Any) -> PolicyDecision:  # noqa: ANN001
        del context
        registry_name = str(tool.metadata["registry_name"])
        if registry_name in _PATCH_TOOL_NAMES and self._context.outcome.patch_proposal is not None:
            return PolicyDecision(PolicyDecisionKind.DENY, _SINGLE_PATCH_ERROR)
        definition = self._context.definitions[registry_name]
        safe_arguments = sanitize_loop_tool_arguments(dict(call.arguments))
        decision = self._context.permission_gate.decide(
            self._context.run,
            definition,
            payload=safe_arguments,
        )
        if decision.status == "deny":
            return PolicyDecision(
                PolicyDecisionKind.DENY,
                f"权限策略阻止工具 {registry_name}：{decision.reason}",
            )
        if decision.status == "require_approval" and not decision.allows_pending_artifact:
            return PolicyDecision(
                PolicyDecisionKind.DENY,
                f"工具 {registry_name} 需要先获得权限确认：{decision.reason}",
            )
        self._context.allow_call(tool.spec.name, call.call_id)
        return PolicyDecision(PolicyDecisionKind.ALLOW)

    def should_retry(self, tool: RuntimeTool, result_retryable: bool, attempt: int) -> bool:
        return tool.retry_safe and tool.idempotent and result_retryable and attempt < 2

    def can_resume_started_tool(self, tool: RuntimeTool, call) -> bool:  # noqa: ANN001
        del call
        return tool.retry_safe and tool.idempotent


class StoryForgeToolSelector:
    def select(self, registry: ToolRegistry, context: Any) -> tuple[RuntimeTool, ...]:
        runtime_context = context if isinstance(context, StoryForgeRuntimeContext) else None
        if runtime_context is None or runtime_context.outcome.patch_proposal is None:
            return registry.all()
        return tuple(
            tool for tool in registry.all() if tool.metadata.get("patch_tool") is not True
        )


class StoryForgeFeedbackFormatter:
    def format(
        self,
        result: RuntimeToolResult,
        *,
        call: ToolCall,
        tool: RuntimeTool | None,
        context: Any,
    ) -> str:
        runtime_context = context if isinstance(context, StoryForgeRuntimeContext) else None
        if result.status.value == "success":
            return serialize_tool_output(result.to_output())
        message = result.error_message or "工具执行失败。"
        if result.error_code == "unknown_tool":
            message = f"未知工具：{call.name}，可用工具为 fs_list / fs_read / fs_search。"
        elif (
            result.error_code == "tool_not_available"
            and runtime_context is not None
            and runtime_context.outcome.patch_proposal is not None
            and tool is not None
            and tool.metadata.get("patch_tool") is True
        ):
            message = _SINGLE_PATCH_ERROR
        elif result.error_code == "invalid_arguments":
            message = f"工具参数解析失败：{message}"
        return json.dumps({"error": message}, ensure_ascii=False)


class StoryForgeRunTracer:
    def __init__(self, context: StoryForgeRuntimeContext) -> None:
        self._context = context

    def emit(self, event: RuntimeTraceEvent) -> None:
        if event.kind != "tool_failed":
            return
        code = str(event.payload.get("code") or "")
        call_id = str(event.payload.get("tool_call_id") or "")
        if code not in _PRE_HANDLER_FAILURE_CODES or call_id in self._context.handled_call_ids:
            return
        call = self._context.calls_by_id.get(call_id)
        if call is None:
            return
        registry_name = _registry_name_from_call(call.name)
        message = _failure_message(code, call, registry_name, self._context)
        if registry_name is None:
            trace = AgentToolTrace(
                tool_name=call.name or "unknown",
                status="failed",
                input_summary={"arguments": call.arguments_json[:500]},
                error_message=message,
            )
            self._context.record_trace(trace, call_id=call_id)
            return
        safe_arguments = _safe_arguments(call.arguments_json)
        evidence = assistant_service.create_assistant_tool_call(
            self._context.session,
            self._context.assistant_session_id,
            AssistantToolCallCreate(
                tool_name=registry_name,
                status="running",
                input_summary=safe_arguments,
            ),
        )
        assistant_service.update_assistant_tool_call(
            self._context.session,
            evidence.id,
            AssistantToolCallUpdate(status="failed", error_message=message[:4000]),
        )
        trace = AgentToolTrace(
            tool_name=registry_name,
            status="failed",
            input_summary=safe_arguments,
            error_message=message,
            assistant_tool_call_id=evidence.id,
        )
        self._context.record_trace(trace, call_id=call_id)


class StoryForgeCheckpointStore:
    def __init__(self, context: StoryForgeRuntimeContext) -> None:
        self._context = context

    def save(self, checkpoint: RuntimeCheckpoint) -> None:
        self._context.latest_checkpoint = checkpoint

    def load(self, run_id: str) -> RuntimeCheckpoint | None:
        checkpoint = self._context.latest_checkpoint
        return checkpoint if checkpoint is not None and checkpoint.run_id == run_id else None


def build_storyforge_tool_registry(context: StoryForgeRuntimeContext) -> ToolRegistry:
    tools: list[RuntimeTool] = []
    for spec in list_loop_tool_specs():
        assert spec.loop_schema is not None
        if spec.name not in context.definitions:
            raise KeyError(f"StoryForge loop tool is not registered: {spec.name}")
        exposed_name = llm_tool_name(spec.name)

        def handler(
            application_context: Any,
            arguments: Mapping[str, Any],
            *,
            active_spec=spec,
            llm_name=exposed_name,
        ) -> RuntimeToolResult:
            runtime_context = (
                application_context
                if isinstance(application_context, StoryForgeRuntimeContext)
                else context
            )
            return _execute_tool(
                runtime_context,
                active_spec.name,
                llm_name,
                arguments,
            )

        tools.append(
            RuntimeTool(
                ToolSpec(
                    exposed_name,
                    spec.loop_schema.description,
                    spec.loop_schema.parameters,
                ),
                handler,
                retry_safe=spec.retry_safe,
                idempotent=spec.idempotent,
                metadata={
                    "registry_name": spec.name,
                    "patch_tool": spec.name in _PATCH_TOOL_NAMES,
                },
            )
        )
    return ToolRegistry(tools)


def interruption_check(context: StoryForgeRuntimeContext):
    def check(run_id: str, boundary: str, checkpoint: RuntimeCheckpoint) -> str | None:
        del run_id, checkpoint
        if context.should_interrupt is None:
            return None
        interruption = context.should_interrupt(boundary)
        if interruption is None:
            return None
        context.interruption = interruption
        return str(interruption.get("status") or "interrupted")

    return check


def _execute_tool(
    context: StoryForgeRuntimeContext,
    registry_name: str,
    llm_name: str,
    arguments: Mapping[str, Any],
) -> RuntimeToolResult:
    call = context.claim_allowed_call(llm_name)
    call_id = call.id if call is not None else None
    safe_arguments = sanitize_loop_tool_arguments(dict(arguments))
    evidence = assistant_service.create_assistant_tool_call(
        context.session,
        context.assistant_session_id,
        AssistantToolCallCreate(
            tool_name=registry_name,
            status="running",
            input_summary=safe_arguments,
        ),
    )
    try:
        tool_result = context.execute_tool(registry_name, dict(arguments))
    except Exception as exc:  # noqa: BLE001 - domain errors are model feedback, not runtime crashes
        error_text = str(exc)[:500]
        assistant_service.update_assistant_tool_call(
            context.session,
            evidence.id,
            AssistantToolCallUpdate(status="failed", error_message=error_text[:4000]),
        )
        context.record_trace(
            AgentToolTrace(
                tool_name=registry_name,
                status="failed",
                input_summary=safe_arguments,
                error_message=error_text,
                assistant_tool_call_id=evidence.id,
            ),
            call_id=call_id,
        )
        return RuntimeToolResult.failure("storyforge_tool_error", error_text)

    output = tool_result.output
    context.outcome.artifacts.extend(tool_result.artifacts)
    feedback = LoopToolFeedback.from_output(
        registry_name,
        output,
        patch_tools=_PATCH_TOOL_NAMES,
        review_feedback=review_feedback,
        revise_feedback=revise_feedback,
    )
    if feedback.review_report is not None:
        context.outcome.review_report = feedback.review_report
    if feedback.patch_proposal is not None:
        context.outcome.patch_proposal = feedback.patch_proposal
    output_summary = tool_output_summary(registry_name, output)
    if (
        registry_name in HANDLER_OWNED_TRACE_TOOL_NAMES
        and tool_result.trace.output_summary is not None
    ):
        output_summary = tool_result.trace.output_summary
    assistant_service.update_assistant_tool_call(
        context.session,
        evidence.id,
        AssistantToolCallUpdate(status="completed", output_summary=output_summary),
    )
    input_summary = (
        tool_result.trace.input_summary
        if registry_name in HANDLER_OWNED_TRACE_TOOL_NAMES
        else safe_arguments
    )
    context.record_trace(
        AgentToolTrace(
            tool_name=registry_name,
            status="completed",
            input_summary=input_summary,
            output_summary=output_summary,
            audit_event_id=(
                tool_result.trace.audit_event_id
                if registry_name in HANDLER_OWNED_TRACE_TOOL_NAMES
                else None
            ),
            assistant_tool_call_id=evidence.id,
        ),
        call_id=call_id,
    )
    artifacts = tuple(
        RuntimeArtifact(artifact.kind, artifact.payload) for artifact in tool_result.artifacts
    )
    return RuntimeToolResult.success(feedback.content, artifacts=artifacts)


def _registry_name_from_call(llm_name: str) -> str | None:
    return _LLM_TO_REGISTRY.get(llm_name)


def _safe_arguments(arguments_json: str) -> dict[str, Any]:
    try:
        payload = json.loads(arguments_json or "{}")
    except json.JSONDecodeError:
        return {}
    return sanitize_loop_tool_arguments(payload if isinstance(payload, dict) else {})


def _failure_message(
    code: str,
    call: ToolCall,
    registry_name: str | None,
    context: StoryForgeRuntimeContext,
) -> str:
    if registry_name is None:
        return f"未知工具：{call.name}，可用工具为 fs_list / fs_read / fs_search。"
    if code == "tool_not_available" and context.outcome.patch_proposal is not None:
        return _SINGLE_PATCH_ERROR
    if code == "invalid_arguments":
        return "工具参数解析失败：工具参数不是有效 JSON 对象或不符合 ToolSpec。"
    if code == "runtime_budget":
        return "工具输出预算已用完。"
    if code == "tool_call_budget":
        return "工具调用预算已用完。"
    definition = context.definitions[registry_name]
    decision = context.permission_gate.decide(
        context.run,
        definition,
        payload=_safe_arguments(call.arguments_json),
    )
    if decision.status == "deny":
        return f"权限策略阻止工具 {registry_name}：{decision.reason}"
    if decision.status == "require_approval" and not decision.allows_pending_artifact:
        return f"工具 {registry_name} 需要先获得权限确认：{decision.reason}"
    return "工具执行失败。"
