from __future__ import annotations

from typing import Any

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.events.runtime_support import tool_artifacts_from_result as _tool_artifacts_from_result
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.tools.catalog import list_agent_runtime_tool_specs
from app.domains.agent_runs.tools.execution import (
    ToolExecutionContext,
    ToolHandler,
    ToolResult,
    tool_definition_from_spec,
)


class ToolExecutionRuntimeMixin:
    def _execute_tool(self, tool_name: str, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        tool = self._tool_registry.get(tool_name)
        # fixed pipeline 的 `bookrun.start` 会从实际 command args 移除确认标记，避免把它传给
        # WritingRun DTO；gate 仍需看见已完成的 preflight 确认，故仅在策略输入中补回该事实。
        permission_payload = dict(payload)
        if context.args.get("confirmed") is True or context.args.get("user_confirmed") is True:
            permission_payload["confirmed"] = True
        decision = self._permission_gate.decide(context.run, tool, payload=permission_payload)
        if decision.status == "deny":
            raise AgentOrchestrationError(f"权限策略阻止工具 {tool_name}：{decision.reason}")
        # 只有 risk_confirm / autonomous 的 write_pending 工具可以先产出 proposed patch。其他
        # require_approval 决策必须在 handler 前停止，避免 read/step_confirm 或长任务绕过策略。
        if decision.status == "require_approval" and not decision.allows_pending_artifact:
            raise AgentOrchestrationError(f"工具 {tool_name} 需要先获得权限确认：{decision.reason}")
        return tool.handler(context, payload)

    def _record_result_artifacts(self, run: AgentRun, result: dict[str, Any]) -> None:
        recorded_kinds: set[str] = set()
        for artifact in _tool_artifacts_from_result(result):
            if artifact.kind in recorded_kinds:
                continue
            self._event_sink.record_artifact(
                run,
                kind=artifact.kind,
                payload=artifact.payload,
                requires_confirmation=artifact.requires_confirmation,
            )
            recorded_kinds.add(artifact.kind)

        agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
        review_report = agent_result.get("review_report")
        if isinstance(review_report, dict) and "review_report" not in recorded_kinds:
            self._event_sink.record_artifact(run, kind="review_report", payload=review_report, requires_confirmation=False)
        proposed_patch = result.get("proposed_patch")
        if isinstance(proposed_patch, dict) and "proposed_patch" not in recorded_kinds:
            self._event_sink.record_artifact(
                run,
                kind="proposed_patch",
                payload=proposed_patch,
                requires_confirmation=bool(proposed_patch.get("requires_confirmation", True)),
            )
        book_run = agent_result.get("book_run")
        if (
            isinstance(book_run, dict)
            and isinstance(book_run.get("checkpoint"), list)
            and book_run["checkpoint"]
            and "bookrun_checkpoint" not in recorded_kinds
        ):
            book_run_id = book_run.get("id")
            self._event_sink.record_artifact(
                run,
                kind="bookrun_checkpoint",
                payload={
                    "writing_run_id": book_run_id,
                    "scope": "full_book",
                    "mode": "managed",
                    "status": book_run.get("status"),
                    "book_run_id": book_run_id,
                    "checkpoint": book_run["checkpoint"],
                },
                requires_confirmation=False,
            )

    def _register_tools(self) -> None:
        handlers: dict[str, ToolHandler] = {}
        for domain_handlers in (
            self._fs_tool_handlers(),
            self._project_check_tool_handlers(),
            self._project_canon_tool_handlers(),
            self._prose_continue_tool_handlers(),
            self._fixed_pipeline_tool_handlers(),
        ):
            duplicate_names = handlers.keys() & domain_handlers.keys()
            if duplicate_names:
                names = ", ".join(sorted(duplicate_names))
                raise AgentOrchestrationError(f"Agent Runtime 工具 handler 重复注册：{names}")
            handlers.update(domain_handlers)
        for spec in list_agent_runtime_tool_specs():
            handler = handlers.get(spec.name)
            if handler is None:
                raise AgentOrchestrationError(f"Agent Runtime 工具缺少 handler：{spec.name}")
            self._tool_registry.register(tool_definition_from_spec(spec, handler))
