from __future__ import annotations

import json
from typing import Any

from app.domains.agent_runs.adapters.chapter_source_guard import prepare_chapter_writing_context
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    brief_prompt,
    build_check,
    check_prompt,
    draft_instruction,
    parse_brief,
    repair_instruction,
)
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.llm_context import llm_context_snapshot_trace_summary
from app.domains.agent_runs.tools import ToolExecutionContext, ToolResult
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantDraftRequest, AssistantReviseRequest


class ChapterWritingToolsMixin:
    def _chapter_brief(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        seed = payload["seed"]
        prompt_bundle = payload["llm_prompt_context_bundle"]
        provenance = llm_context_snapshot_trace_summary(payload["llm_context_snapshot"])
        try:
            chat = assistant_service.chat_reply(
                context.session,
                user_message=brief_prompt(seed, context.user_message),
                context_block=json.dumps(prompt_bundle, ensure_ascii=False),
                assistant_session_id=context.assistant_session_id,
            )
            brief = parse_brief(chat["reply"], seed=seed, provenance=provenance)
        except (
            assistant_service.AssistantLlmNotConfiguredError,
            assistant_service.AssistantReviseError,
            AgentOrchestrationError,
        ) as exc:
            raise AgentOrchestrationError(str(exc)) from exc
        return ToolResult(
            status="completed",
            output={"brief": brief},
            trace=AgentToolTrace(
                tool_name="chapter.brief",
                status="completed",
                input_summary={"target_path": brief["target_path"], **provenance},
                output_summary={"brief_id": brief["brief_id"], "revision": brief["revision"]},
            ),
        )

    def _chapter_draft(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        brief = payload["brief"]
        prepared = prepare_chapter_writing_context(
            payload["project_root"],
            payload["target_absolute"],
            payload["llm_prompt_context_bundle"],
            payload["source_guard"],
            content="",
            intent="file.create",
        )
        response = assistant_service.draft_file_content(
            context.session,
            AssistantDraftRequest(
                file_path=payload["target_absolute"],
                instruction=draft_instruction(brief),
                project_name=payload.get("project_name"),
                project_root=payload["project_root"],
                assistant_session_id=context.assistant_session_id,
                context_bundle=prepared.context_bundle,
            ),
            prepared_context=prepared,
        )
        return ToolResult(
            status="completed",
            output={"content": response.content, "model": response.model},
            trace=AgentToolTrace(
                tool_name="chapter.draft",
                status="completed",
                input_summary={"brief_id": brief["brief_id"], "target_path": payload["target_relative"]},
                output_summary={"content_chars": len(response.content), "model": response.model},
            ),
        )

    def _chapter_check(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        provider_failed = False
        try:
            chat = assistant_service.chat_reply(
                context.session,
                user_message=check_prompt(payload["brief"], payload["content"]),
                context_block="",
                assistant_session_id=context.assistant_session_id,
            )
            raw = chat["reply"]
        except (assistant_service.AssistantLlmNotConfiguredError, assistant_service.AssistantReviseError):
            raw, provider_failed = None, True
        check = build_check(payload["content"], payload["brief"], raw, provider_failed=provider_failed)
        # Generic step/UI vocabulary has no incomplete state; keep the exact
        # checker state in output_summary, never render an unfinished check green.
        trace_status = "completed" if check["execution_status"] == "completed" else "failed"
        return ToolResult(
            status=trace_status,
            output={"check": check},
            trace=AgentToolTrace(
                tool_name="chapter.check",
                status=trace_status,
                input_summary={"brief_id": payload["brief"]["brief_id"], "attempt": payload["attempt"]},
                output_summary={
                    "status": check["status"],
                    "execution_status": check["execution_status"],
                    "execution_code": check["execution_code"],
                    "coverage": check["coverage"],
                    "manuscript_status": check["manuscript_status"],
                    "manuscript_hard_failure_count": check["manuscript_hard_failure_count"],
                    "hard_failure_count": check["hard_failure_count"],
                    "advisory_count": check["advisory_count"],
                },
            ),
        )

    def _chapter_repair(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        prepared = prepare_chapter_writing_context(
            payload["project_root"],
            payload["target_absolute"],
            payload["llm_prompt_context_bundle"],
            payload["source_guard"],
            content=payload["content"],
            intent="file.revise",
        )
        response = assistant_service.revise_file_content(
            context.session,
            AssistantReviseRequest(
                file_path=payload["target_absolute"],
                content=payload["content"],
                instruction=repair_instruction(payload["check"], payload["brief"]),
                project_name=payload.get("project_name"),
                project_root=payload["project_root"],
                assistant_session_id=context.assistant_session_id,
                context_bundle=prepared.context_bundle,
            ),
            prepared_context=prepared,
        )
        return ToolResult(
            status="completed",
            output={"content": response.after, "model": response.model},
            trace=AgentToolTrace(
                tool_name="chapter.repair",
                status="completed",
                input_summary={
                    "brief_id": payload["brief"]["brief_id"],
                    "hard_failure_count": payload["check"]["hard_failure_count"],
                },
                output_summary={"content_chars": len(response.after), "model": response.model},
            ),
        )
