from __future__ import annotations

from typing import Any

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.tools import ToolExecutionContext, ToolHandler, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import safe_summary
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantToolCallCreate, AssistantToolCallUpdate
from app.domains.ide.service import IdeCommandExecutionError, IdeCommandNotFoundError, execute_ide_command_by_id

MANAGED_BOOKRUN_COMMAND_IDS = (
    "bookrun.start",
    "bookrun.pause",
    "bookrun.resume",
    "bookrun.retry_from_checkpoint",
)


def managed_bookrun_handlers() -> dict[str, ToolHandler]:
    return {command_id: managed_bookrun_handler(command_id) for command_id in MANAGED_BOOKRUN_COMMAND_IDS}


def managed_bookrun_handler(command_id: str) -> ToolHandler:
    def handler(context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        input_summary = safe_summary(payload)
        tool_call = assistant_service.create_assistant_tool_call(
            context.session,
            context.assistant_session_id,
            AssistantToolCallCreate(tool_name=command_id, status="running", input_summary=input_summary),
        )
        try:
            result = execute_ide_command_by_id(command_id, payload, context.session)
        except (IdeCommandNotFoundError, IdeCommandExecutionError) as exc:
            assistant_service.update_assistant_tool_call(
                context.session,
                tool_call.id,
                AssistantToolCallUpdate(status="failed", error_message=str(exc)[:4000]),
            )
            raise AgentOrchestrationError(str(exc)) from exc
        output_summary = safe_summary(result.payload)
        assistant_service.update_assistant_tool_call(
            context.session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="completed",
                output_summary={**output_summary, "audit_event_id": result.audit_event_id},
            ),
        )
        return ToolResult(
            status="completed",
            output={"result": result.model_dump()},
            summary=f"{command_id} completed",
            payload=result.payload,
            metrics={"payload_key_count": len(result.payload)},
            trace=AgentToolTrace(
                tool_name=command_id,
                status="completed",
                input_summary=input_summary,
                output_summary=output_summary,
                audit_event_id=result.audit_event_id,
                assistant_tool_call_id=tool_call.id,
            ),
        )

    return handler
