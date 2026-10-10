from __future__ import annotations

import uuid
from typing import Any

from app.common.author_voice import build_generation_system_prompt, edit_policy_from_generation_prompt
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.patches.polish_context import (
    polish_author_requirements_from_context_snapshot,
    polish_constraints_from_context_snapshot,
)
from app.domains.agent_runs.patches.polishing_service import (
    ControlledPolishResult,
    resolve_polishable_target,
    run_controlled_polish,
)
from app.domains.agent_runs.patches.revise_input import prepare_revision_scope
from app.domains.agent_runs.patches.types import PatchProposal
from app.domains.agent_runs.patches.writing_context import prepare_runtime_writing_context
from app.domains.agent_runs.permission import patch_requires_confirmation
from app.domains.agent_runs.revise_scope import public_revise_scope as _public_revise_scope
from app.domains.agent_runs.revise_scope import revise_summary_with_scope as _revise_summary_with_scope
from app.domains.agent_runs.revise_scope import scope_issues as _scope_issues
from app.domains.agent_runs.revise_scope import scope_warning as _scope_warning
from app.domains.agent_runs.tools import ToolArtifact, ToolExecutionContext, ToolHandler, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import llm_context_input_summary as _llm_context_input_summary
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.agent_runs.tools.runtime_arguments import required_text as _required_text
from app.domains.agent_runs.tools.runtime_arguments import string_list as _string_list
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import (
    AssistantDraftRequest,
    AssistantReviseRequest,
)


class PatchRuntimeToolsMixin:
    def _fixed_pipeline_tool_handlers(self) -> dict[str, ToolHandler]:
        handlers: dict[str, ToolHandler] = {
            "file.review": self._file_review,
            "file.revise": self._file_revise,
            "chapter.polish": self._chapter_polish,
            "file.create": self._file_create,
            "judge.run": self._judge_run,
        }
        return handlers

    def _judge_run(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        """对生成内容做确定性轻量自检（file.revise 管线产字后调用）。

        2026-10 删 DB 实体审稿链后只剩这一条纯函数路径；原先 mode 不匹配时会转交
        已删除的 judge.run IDE 命令。
        """
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

    def _chapter_polish(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        trace_file_path = _optional_string(payload.get("_trace_file_path")) or file_path
        root = _optional_string(payload.get("project_root")) or _optional_string(context.args.get("project_path"))
        try:
            file_path, trace_file_path = resolve_polishable_target(root, file_path, trace_file_path)
        except ValueError as exc:
            raise AgentOrchestrationError(str(exc)) from exc
        payload.update(file_path=file_path, _trace_file_path=trace_file_path)
        content = _required_text(payload, "content")
        if not content.strip():
            raise AgentOrchestrationError("正文为空，无法润色。")
        prepare_runtime_writing_context(context, payload, intent="chapter.polish")
        style_instruction = _optional_string(payload.get("style_instruction")) or context.user_message
        trusted_constraints = polish_constraints_from_context_snapshot(payload.get("llm_context_snapshot"))
        protected_entities = list(
            dict.fromkeys(
                [
                    *trusted_constraints["protected_entities"],
                    *_string_list(payload.get("protected_entities")),
                ]
            )
        )
        character_constraints = [
            *trusted_constraints["character_constraints"],
            *_dict_items(payload.get("character_constraints")),
        ]
        continuity_facts = [
            *trusted_constraints["continuity_facts"],
            *_sequence_items(payload.get("continuity_facts")),
        ]
        required_facts = list(
            dict.fromkeys(
                [
                    *trusted_constraints["required_facts"],
                    *_string_list(payload.get("required_facts")),
                ]
            )
        )
        constraint_counts = {
            "protected_entities": len(protected_entities),
            "character_constraints": len(character_constraints),
            "continuity_facts": len(continuity_facts),
            "required_facts": len(required_facts),
        }
        prepared_voice = build_generation_system_prompt("", root)
        try:
            edit_policy = edit_policy_from_generation_prompt(
                content,
                instruction=context.user_message,
                system_prompt=prepared_voice,
                admitted_author_requirements=(
                    ()
                    if root
                    else polish_author_requirements_from_context_snapshot(payload.get("llm_context_snapshot"))
                ),
            )
        except ValueError as exc:
            raise AgentOrchestrationError(str(exc)) from exc
        result = run_controlled_polish(
            content,
            style_instruction=style_instruction,
            protected_entities=protected_entities,
            character_constraints=character_constraints,
            continuity_facts=continuity_facts,
            required_facts=required_facts,
            use_main_model=payload.get("use_main_model") is True,
            online_enabled=payload.get("online_enabled") is not False,
            edit_policy=edit_policy,
        )
        decision = result.decision
        summary = _polish_summary(result)
        output: dict[str, Any] = {
            "file_path": file_path,
            "before": content,
            "after": decision.text,
            "summary": summary,
            "constraint_counts": constraint_counts,
            **result.trace_summary(),
        }
        trace_summary = {
            "file_path": trace_file_path,
            "before_chars": len(content),
            "after_chars": len(decision.text),
            "constraint_counts": constraint_counts,
            **result.trace_summary(),
        }
        if decision.selected_source == "original":
            return ToolResult(
                status="completed",
                output=output,
                summary=summary,
                metrics={"before_chars": len(content), "after_chars": len(content)},
                trace=AgentToolTrace(
                    tool_name="chapter.polish",
                    status=decision.status,
                    input_summary={
                        "file_path": trace_file_path,
                        "content_chars": len(content),
                        "style_instruction_present": bool(style_instruction.strip()),
                        **_llm_context_input_summary(payload.get("llm_context_snapshot")),
                    },
                    output_summary=trace_summary,
                ),
            )

        requires_confirm = decision.degraded or patch_requires_confirmation(context.run.permission_profile)
        proposed_patch = {
            "id": f"chapter-polish-{uuid.uuid4().hex}",
            "kind": "file_revision",
            "created_by_tool": "chapter.polish",
            "file_path": file_path,
            "before": content,
            "after": decision.text,
            "requires_confirmation": requires_confirm,
            "approval_action": "desktop.confirm_file_writeback",
            "polish_status": decision.status,
            "candidate_source": decision.selected_source,
            "degraded": decision.degraded,
        }
        patch_proposal = PatchProposal.from_payload(proposed_patch)
        output["proposed_patch"] = proposed_patch
        trace_summary["patch_id"] = proposed_patch["id"]
        trace_summary["requires_confirmation"] = requires_confirm
        return ToolResult(
            status="completed",
            output=output,
            summary=summary,
            payload={"proposed_patch": proposed_patch},
            artifacts=(
                ToolArtifact(
                    kind="proposed_patch",
                    payload=proposed_patch,
                    requires_confirmation=requires_confirm,
                ),
            ),
            metrics={
                "before_chars": len(content),
                "after_chars": len(decision.text),
                "total_tokens": int(result.usage.get("total_tokens") or 0),
            },
            patch_proposal=patch_proposal,
            trace=AgentToolTrace(
                tool_name="chapter.polish",
                status=decision.status,
                input_summary={
                    "file_path": trace_file_path,
                    "content_chars": len(content),
                    "style_instruction_present": bool(style_instruction.strip()),
                    **_llm_context_input_summary(payload.get("llm_context_snapshot")),
                },
                output_summary=trace_summary,
            ),
        )

    def _file_revise(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        trace_file_path = _optional_string(payload.get("_trace_file_path")) or file_path
        # 空文件也要能修订：作者建好空章节文件后直接说「写这章」，走的就是这条路。
        content = _required_text(payload, "content")
        project_root = _optional_string(payload.get("project_root")) or _optional_string(
            context.args.get("project_path")
        )
        instruction = _optional_string(payload.get("instruction")) or context.user_message
        review_report, scope, effective_instruction = prepare_revision_scope(
            context,
            payload,
            instruction=instruction,
            file_path=file_path,
            content=content,
            project_root=project_root,
        )
        public_scope = _public_revise_scope(scope)
        prepared = prepare_runtime_writing_context(context, payload, intent="file.revise")
        try:
            response = assistant_service.revise_file_content(
                context.session,
                AssistantReviseRequest(
                    file_path=file_path,
                    content=content,
                    instruction=effective_instruction,
                    project_name=_optional_string(payload.get("project_name")),
                    project_root=project_root,
                    assistant_session_id=context.assistant_session_id,
                    context_bundle=prepared.context_bundle,
                ),
                author_instruction=context.user_message,
                prepared_context=prepared,
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
        requires_confirm = patch_requires_confirmation(context.run.permission_profile)
        proposed_patch = {
            "id": f"file-revision-{uuid.uuid4().hex}",
            "kind": "file_revision",
            "file_path": file_path,
            "before": response.before,
            "after": response.after,
            "requires_confirmation": requires_confirm,
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
            "file_path": trace_file_path,
            "patch_id": proposed_patch["id"],
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
            artifacts=(
                ToolArtifact(kind="proposed_patch", payload=proposed_patch, requires_confirmation=requires_confirm),
            ),
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
                    "file_path": trace_file_path,
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
        trace_file_path = _optional_string(payload.get("_trace_file_path")) or file_path
        instruction = _optional_string(payload.get("instruction")) or context.user_message
        prepared = prepare_runtime_writing_context(context, payload, intent="file.create")
        try:
            response = assistant_service.draft_file_content(
                context.session,
                AssistantDraftRequest(
                    file_path=file_path,
                    instruction=instruction,
                    project_name=_optional_string(payload.get("project_name")),
                    project_root=_optional_string(payload.get("project_root")),
                    assistant_session_id=context.assistant_session_id,
                    context_bundle=prepared.context_bundle,
                ),
                prepared_context=prepared,
            )
        except (
            assistant_service.AssistantLlmNotConfiguredError,
            assistant_service.AssistantReviseError,
            assistant_service.AssistantSessionNotFoundError,
        ) as exc:
            raise AgentOrchestrationError(str(exc)) from exc

        requires_confirm = patch_requires_confirmation(context.run.permission_profile)
        proposed_patch = {
            "id": f"file-creation-{uuid.uuid4().hex}",
            "kind": "file_revision",
            "created_by_tool": "file.create",
            "file_path": file_path,
            "before": "",
            "after": response.content,
            "requires_confirmation": requires_confirm,
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
            artifacts=(
                ToolArtifact(kind="proposed_patch", payload=proposed_patch, requires_confirmation=requires_confirm),
            ),
            metrics={
                "content_chars": len(response.content),
                "completion_tokens": response.completion_tokens,
                "latency_ms": response.latency_ms,
            },
            patch_proposal=patch_proposal,
            trace=AgentToolTrace(
                tool_name="file.create",
                status="completed",
                input_summary={
                    "file_path": trace_file_path,
                    "instruction": instruction[:200],
                    **_llm_context_input_summary(payload.get("llm_context_snapshot")),
                },
                output_summary={
                    "file_path": trace_file_path,
                    "content_chars": len(response.content),
                    "model": response.model,
                    "patch_id": proposed_patch["id"],
                },
            ),
        )

def _dict_items(value: object) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _sequence_items(value: object) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _polish_summary(result: ControlledPolishResult) -> str:
    decision = result.decision
    if decision.status == "accepted":
        return "润色候选已通过相对原文质量门禁，已生成可审阅补丁。"
    if decision.status == "degraded":
        return "在线候选不可用或未通过门禁，已生成明确标注的本地降级补丁。"
    if decision.status == "noop":
        return "润色候选与原文一致，没有生成空补丁。"
    if result.online_failure == "polish_model_not_configured":
        return "专用润色模型尚未配置，且本地规则没有产生合格改动；原文保持不变。"
    return "在线与本地候选均未通过质量门禁，原文保持不变。"
