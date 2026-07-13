from __future__ import annotations

import uuid
from typing import Any

from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.adapters.bookrun_managed_run_adapter import managed_bookrun_handlers
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.patches.types import PatchProposal
from app.domains.agent_runs.revise_scope import public_revise_scope as _public_revise_scope
from app.domains.agent_runs.revise_scope import resolve_revise_scope as _resolve_revise_scope
from app.domains.agent_runs.revise_scope import revise_summary_with_scope as _revise_summary_with_scope
from app.domains.agent_runs.revise_scope import scope_issues as _scope_issues
from app.domains.agent_runs.revise_scope import scope_warning as _scope_warning
from app.domains.agent_runs.revise_scope import scoped_revise_instruction as _scoped_revise_instruction
from app.domains.agent_runs.tools import ToolArtifact, ToolExecutionContext, ToolHandler, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import llm_context_input_summary as _llm_context_input_summary
from app.domains.agent_runs.tools.runtime_arguments import (
    proposed_patch_from_repair_patch as _proposed_patch_from_repair_patch,
)
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.agent_runs.tools.runtime_arguments import safe_summary as _safe_summary
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import (
    AssistantDraftRequest,
    AssistantReviseRequest,
    AssistantToolCallCreate,
    AssistantToolCallUpdate,
)
from app.domains.ide.service import IdeCommandExecutionError, IdeCommandNotFoundError, execute_ide_command_by_id


class PatchRuntimeToolsMixin:
    def _fixed_pipeline_tool_handlers(self) -> dict[str, ToolHandler]:
        handlers: dict[str, ToolHandler] = {
            "file.review": self._file_review,
            "file.revise": self._file_revise,
            "file.create": self._file_create,
            "judge.run": self._judge_run,
        }
        handlers["judge.repair"] = self._ide_command_tool("judge.repair")
        handlers.update(managed_bookrun_handlers())
        return handlers

    def _file_revise(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = _required_string(payload, "content")
        instruction = _optional_string(payload.get("instruction")) or context.user_message
        review_report = payload.get("review_report") if isinstance(payload.get("review_report"), dict) else None
        prompt_context_bundle = (
            payload.get("llm_prompt_context_bundle")
            if isinstance(payload.get("llm_prompt_context_bundle"), dict)
            else payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else None
        )
        scope = _resolve_revise_scope(review_report, {**payload, "instruction": instruction})
        public_scope = _public_revise_scope(scope)
        effective_instruction = _scoped_revise_instruction(instruction, review_report, scope)
        try:
            response = assistant_service.revise_file_content(
                context.session,
                AssistantReviseRequest(
                    file_path=file_path,
                    content=content,
                    instruction=effective_instruction,
                    project_name=_optional_string(payload.get("project_name")),
                    assistant_session_id=context.assistant_session_id,
                    context_bundle=prompt_context_bundle,
                ),
            )
        except (
            assistant_service.AssistantLlmNotConfiguredError,
            assistant_service.AssistantReviseError,
            assistant_service.AssistantSessionNotFoundError,
        ) as exc:
            raise AgentOrchestrationError(str(exc)) from exc

        summary = _revise_summary_with_scope(response.summary, scope)
        scope_warning = _scope_warning(scope, response.before, response.after)
        if scope_warning is not None:
            summary = f"{summary} {scope_warning['message']}"
        proposed_patch = {
            "id": f"file-revision-{uuid.uuid4().hex}",
            "kind": "file_revision",
            "file_path": file_path,
            "before": response.before,
            "after": response.after,
            "requires_confirmation": True,
            "approval_action": "desktop.confirm_file_writeback",
        }
        patch_proposal = PatchProposal.from_payload(proposed_patch)
        output = {
            "file_path": file_path,
            "before": response.before,
            "after": response.after,
            "summary": summary,
            "model": response.model,
            "latency_ms": response.latency_ms,
            "completion_tokens": response.completion_tokens,
            "assistant_session_id": response.assistant_session_id,
            "applied_scope": public_scope,
            "proposed_patch": proposed_patch,
        }
        revise_output_summary: dict[str, Any] = {
            "after_chars": len(response.after),
            "model": response.model,
            "latency_ms": response.latency_ms,
            "completion_tokens": response.completion_tokens,
            "applied_scope": public_scope,
        }
        if scope_warning is not None:
            output["scope_warning"] = scope_warning
            revise_output_summary["scope_warning"] = scope_warning
        return ToolResult(
            status="completed",
            output=output,
            summary=summary,
            payload={"proposed_patch": proposed_patch},
            artifacts=(ToolArtifact(kind="proposed_patch", payload=proposed_patch, requires_confirmation=True),),
            metrics={
                "after_chars": len(response.after),
                "completion_tokens": response.completion_tokens,
                "latency_ms": response.latency_ms,
            },
            patch_proposal=patch_proposal,
            trace=AgentToolTrace(
                tool_name="file.revise",
                status="completed",
                input_summary={
                    "file_path": file_path,
                    "content_chars": len(content),
                    "review_issue_count": len(_scope_issues(scope)),
                    "applied_scope": public_scope,
                    **_llm_context_input_summary(payload.get("llm_context_snapshot")),
                },
                output_summary=revise_output_summary,
            ),
        )

    def _file_create(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        instruction = _optional_string(payload.get("instruction")) or context.user_message
        prompt_context_bundle = (
            payload.get("llm_prompt_context_bundle")
            if isinstance(payload.get("llm_prompt_context_bundle"), dict)
            else payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else None
        )
        try:
            response = assistant_service.draft_file_content(
                context.session,
                AssistantDraftRequest(
                    file_path=file_path,
                    instruction=instruction,
                    project_name=_optional_string(payload.get("project_name")),
                    assistant_session_id=context.assistant_session_id,
                    context_bundle=prompt_context_bundle,
                ),
            )
        except (
            assistant_service.AssistantLlmNotConfiguredError,
            assistant_service.AssistantReviseError,
            assistant_service.AssistantSessionNotFoundError,
        ) as exc:
            raise AgentOrchestrationError(str(exc)) from exc

        proposed_patch = {
            "id": f"file-creation-{uuid.uuid4().hex}",
            "kind": "file_revision",
            "created_by_tool": "file.create",
            "file_path": file_path,
            "before": "",
            "after": response.content,
            "requires_confirmation": True,
            "approval_action": "desktop.confirm_file_writeback",
        }
        patch_proposal = PatchProposal.from_payload(proposed_patch)
        output = {
            "file_path": file_path,
            "before": "",
            "after": response.content,
            "summary": response.summary,
            "model": response.model,
            "latency_ms": response.latency_ms,
            "completion_tokens": response.completion_tokens,
            "assistant_session_id": response.assistant_session_id,
            "proposed_patch": proposed_patch,
        }
        return ToolResult(
            status="completed",
            output=output,
            summary=response.summary,
            payload={"proposed_patch": proposed_patch},
            artifacts=(ToolArtifact(kind="proposed_patch", payload=proposed_patch, requires_confirmation=True),),
            metrics={
                "content_chars": len(response.content),
                "completion_tokens": response.completion_tokens,
                "latency_ms": response.latency_ms,
            },
            patch_proposal=patch_proposal,
            trace=AgentToolTrace(
                tool_name="file.create",
                status="completed",
                input_summary={"file_path": file_path, "instruction": instruction[:200]},
                output_summary={
                    "file_path": file_path,
                    "content_chars": len(response.content),
                    "model": response.model,
                    "patch_id": proposed_patch["id"],
                },
            ),
        )

    def _judge_run(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        if payload.get("mode") == "proposed_patch_smoke":
            content = str(payload.get("content") or "")
            issue_count = 0
            if any(marker in content for marker in ("这说明", "其实", "显然")):
                issue_count += 1
            output = {"issue_count": issue_count, "mode": "proposed_patch_smoke"}
            return ToolResult(
                status="completed",
                output=output,
                trace=AgentToolTrace(
                    tool_name="judge.run",
                    status="completed",
                    input_summary={"content_chars": len(content), "mode": "proposed_patch_smoke"},
                    output_summary=output,
                ),
            )
        handler = self._ide_command_tool("judge.run")
        return handler(context, payload)

    def _ide_command_tool(self, command_id: str) -> ToolHandler:
        def handler(context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
            tool_call = assistant_service.create_assistant_tool_call(
                context.session,
                context.assistant_session_id,
                AssistantToolCallCreate(tool_name=command_id, status="running", input_summary=_safe_summary(payload)),
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
            output_summary = _safe_summary(result.payload)
            tool_artifacts: list[ToolArtifact] = []
            patch_proposal: PatchProposal | None = None
            if command_id == "judge.repair":
                patch_payload = result.payload.get("patch") if isinstance(result.payload.get("patch"), dict) else None
                proposed_patch = _proposed_patch_from_repair_patch(patch_payload) if patch_payload else None
                if proposed_patch is not None:
                    patch_proposal = PatchProposal.from_payload(proposed_patch)
                    tool_artifacts.append(
                        ToolArtifact(kind="proposed_patch", payload=proposed_patch, requires_confirmation=True)
                    )
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
                artifacts=tuple(tool_artifacts),
                metrics={"payload_key_count": len(result.payload)},
                patch_proposal=patch_proposal,
                trace=AgentToolTrace(
                    tool_name=command_id,
                    status="completed",
                    input_summary=_safe_summary(payload),
                    output_summary=output_summary,
                    audit_event_id=result.audit_event_id,
                    assistant_tool_call_id=tool_call.id,
                ),
            )

        return handler
