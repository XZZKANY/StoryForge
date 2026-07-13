from __future__ import annotations

import uuid
from typing import Any

from app.domains.agent_runs import canon_service, fs_tools
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.canon_delta import canon_delta
from app.domains.agent_runs.canon_hooks_delta import hooks_delta
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.patches.types import PatchProposal
from app.domains.agent_runs.tools.execution import ToolArtifact, ToolExecutionContext, ToolHandler, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import optional_int as _optional_int
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.agent_runs.tools.runtime_arguments import trim_prose_instruction as _trim_prose_instruction
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantReviseRequest


class ProjectCanonRuntimeMixin:
    def _project_canon_tool_handlers(self) -> dict[str, ToolHandler]:
        return {
            "project.canon": self._project_canon,
            "project.canon_delta": self._project_canon_delta,
            "project.hooks_delta": self._project_hooks_delta,
            "project.trim_prose": self._project_trim_prose,
        }

    def _project_canon(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        glob = _optional_string(payload.get("glob")) or "*.md"
        refresh = payload.get("refresh") is not False
        # 确定性投影核心（写派生缓存 + dossier）下沉 canon_service，与 IDE 命令 canon.refresh 共用。
        output = canon_service.run_canon_projection(project_root, glob=glob, refresh=refresh)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.canon",
                status="completed",
                input_summary={"refresh": refresh, "glob": glob},
                output_summary={
                    "entity_count": output["entity_count"],
                    "checked_invariants": output["checked_invariants"],
                    "conflict_count": output["conflict_count"],
                    "advisory_count": output["advisory_count"],
                },
            ),
        )

    def _project_canon_delta(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        delta_args: dict[str, Any] = {}
        for key in ("entities", "holder_claims", "exit_claims", "timeline_claims"):
            if key not in payload:
                continue
            value = payload[key]
            if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
                raise fs_tools.FsToolError(f"{key} 必须是对象数组。")
            delta_args[key] = value

        output = canon_delta(project_root, **delta_args)
        proposals = output["proposals"]
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.canon_delta",
                status="completed",
                input_summary={
                    "entity_count": len(delta_args.get("entities") or []),
                    "claim_count": sum(
                        len(delta_args.get(key) or [])
                        for key in ("holder_claims", "exit_claims", "timeline_claims")
                    ),
                },
                output_summary={
                    "new_entity_count": len(proposals["new_entities"]),
                    "known_entity_count": len(proposals["known_entities"]),
                    "alias_conflict_count": len(output["alias_conflicts"]),
                    "new_conflict_count": len(output["new_conflicts"]),
                    "new_advisory_count": len(output["new_advisories"]),
                },
            ),
        )

    def _project_hooks_delta(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        delta_args: dict[str, Any] = {}
        observed_hooks = payload.get("observed_hooks")
        if observed_hooks is not None:
            if not isinstance(observed_hooks, list) or any(not isinstance(item, dict) for item in observed_hooks):
                raise fs_tools.FsToolError("observed_hooks 必须是对象数组。")
            delta_args["observed_hooks"] = observed_hooks
        evidence_text = payload.get("evidence_text")
        if isinstance(evidence_text, str) and evidence_text.strip():
            delta_args["evidence_text"] = evidence_text

        output = hooks_delta(project_root, **delta_args)
        new_hooks = output["new_hooks"]
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.hooks_delta",
                status="completed",
                input_summary={
                    "observed_hook_count": len(delta_args.get("observed_hooks") or []),
                    "evidence_text_chars": len(delta_args.get("evidence_text") or ""),
                },
                output_summary={
                    "new_hook_count": len(new_hooks),
                    "duplicate_count": len(output["duplicates"]),
                    "pattern_hit_count": len(output["pattern_hits"]),
                },
            ),
        )

    def _project_trim_prose(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = _required_string(payload, "content")
        target_percent = _optional_int(payload.get("target_percent")) or 15
        if target_percent < 1 or target_percent > 50:
            raise fs_tools.FsToolError("target_percent 必须在 1–50 之间。")

        instruction = _trim_prose_instruction(target_percent)
        try:
            response = assistant_service.revise_file_content(
                context.session,
                AssistantReviseRequest(
                    file_path=file_path,
                    content=content,
                    instruction=instruction,
                    project_name=_optional_string(payload.get("project_name")),
                    assistant_session_id=context.assistant_session_id,
                    context_bundle=payload.get("llm_prompt_context_bundle") or payload.get("context_bundle"),
                ),
            )
        except (
            assistant_service.AssistantLlmNotConfiguredError,
            assistant_service.AssistantReviseError,
            assistant_service.AssistantSessionNotFoundError,
        ) as exc:
            raise AgentOrchestrationError(str(exc)) from exc

        original_chars = len(content)
        compressed_chars = len(response.after)
        actual_percent = round((1 - compressed_chars / original_chars) * 100, 1) if original_chars else 0
        trim_audit = {
            "original_chars": original_chars,
            "compressed_chars": compressed_chars,
            "target_percent": target_percent,
            "actual_percent": actual_percent,
        }

        proposed_patch = {
            "id": f"prose-trim-{uuid.uuid4().hex}",
            "kind": "prose_trim",
            "file_path": file_path,
            "before": response.before,
            "after": response.after,
            "trim_audit": trim_audit,
            "requires_confirmation": True,
            "approval_action": "desktop.confirm_file_writeback",
        }
        patch_proposal = PatchProposal.from_payload(proposed_patch)

        summary = f"压缩完成：{original_chars} → {compressed_chars} 字（{actual_percent}%），目标 {target_percent}%。"
        output = {
            "file_path": file_path,
            "before": response.before,
            "after": response.after,
            "summary": summary,
            "model": response.model,
            "latency_ms": response.latency_ms,
            "completion_tokens": response.completion_tokens,
            "assistant_session_id": response.assistant_session_id,
            "trim_audit": trim_audit,
            "proposed_patch": proposed_patch,
        }
        return ToolResult(
            status="completed",
            output=output,
            summary=summary,
            payload={"proposed_patch": proposed_patch},
            artifacts=(ToolArtifact(kind="proposed_patch", payload=proposed_patch, requires_confirmation=True),),
            metrics={
                "after_chars": compressed_chars,
                "completion_tokens": response.completion_tokens,
                "latency_ms": response.latency_ms,
                "compression_percent": actual_percent,
            },
            patch_proposal=patch_proposal,
            trace=AgentToolTrace(
                tool_name="project.trim_prose",
                status="completed",
                input_summary={"file_path": file_path, "target_percent": target_percent},
                output_summary={
                    "original_chars": original_chars,
                    "compressed_chars": compressed_chars,
                    "compression_percent": actual_percent,
                },
            ),
        )
