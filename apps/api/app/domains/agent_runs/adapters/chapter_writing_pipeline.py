from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from app.domains.agent_runs import serial_plan
from app.domains.agent_runs.adapters.chapter_source_guard import assert_chapter_sources, capture_chapter_sources
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    CHAPTER_BRIEF_ARTIFACT_KIND,
    CHAPTER_CANDIDATE_ARTIFACT_KIND,
    CHAPTER_CHECK_ARTIFACT_KIND,
    CHAPTER_WRITE_INTENT,
    build_brief_seed,
    confirm_brief,
    resolve_target,
)
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    brief_prompt as brief_prompt,
)
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    build_check as build_check,
)
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    check_prompt as check_prompt,
)
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    draft_instruction as draft_instruction,
)
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    parse_brief as parse_brief,
)
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    repair_instruction as repair_instruction,
)
from app.domains.agent_runs.adapters.chapter_writing_tools import ChapterWritingToolsMixin
from app.domains.agent_runs.adapters.intent_fixed_pipeline_adapter import FixedPipelineRequest
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.events.runtime_support import (
    base_response,
    latest_runtime_pending_call,
    plan_step,
    runtime_interrupted_response,
    runtime_pending_call_resolution_artifact,
)
from app.domains.agent_runs.intent import role_hints, role_mentions
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    llm_context_snapshot_to_prompt_context_bundle,
)
from app.domains.agent_runs.llm_context import (
    llm_context_snapshot_trace_summary as llm_context_snapshot_trace_summary,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.agent_runs.permission import patch_requires_confirmation
from app.domains.agent_runs.runtime_delivery import check_result_delivery
from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
from app.domains.agent_runs.tools import ToolArtifact, ToolExecutionContext, ToolHandler
from app.domains.agent_runs.tools import ToolResult as ToolResult
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantDraftRequest as AssistantDraftRequest
from app.domains.assistant.schemas import AssistantMessageCreate
from app.domains.assistant.schemas import AssistantReviseRequest as AssistantReviseRequest


class ChapterWritingRuntimeMixin(ChapterWritingToolsMixin):
    def run_chapter_writing_pipeline(self, request: FixedPipelineRequest) -> dict[str, Any]:
        pending = latest_runtime_pending_call(request.session, request.run)
        if self._is_chapter_resume(request.run, pending):
            return self._resume_chapter_writing(request, pending)
        return self._start_chapter_brief(request)

    def _chapter_writing_tool_handlers(self) -> dict[str, ToolHandler]:
        return {
            "chapter.brief": self._chapter_brief,
            "chapter.draft": self._chapter_draft,
            "chapter.check": self._chapter_check,
            "chapter.repair": self._chapter_repair,
        }

    def _start_chapter_brief(self, request: FixedPipelineRequest) -> dict[str, Any]:
        project_root = self._required_project_root(request.args)
        target_relative, target_absolute, planned = resolve_target(
            project_root, request.args.get("file_path") or request.args.get("current_file")
        )
        plan = serial_plan.build_plan(project_root)
        snapshot = build_llm_context_snapshot(
            run_state=request.run,
            intent=CHAPTER_WRITE_INTENT,
            user_message=request.user_message,
            file_path=target_relative,
            content="",
            context_bundle={
                **(request.args.get("context_bundle") or {}),
                "project_root": project_root,
                "current_file": target_relative,
            },
            role_hints=role_hints(request.args),
            role_mentions=role_mentions(request.args),
            event_history=request.run.events,
            artifacts=request.run.artifacts,
        )
        prompt_bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
        source_guard = capture_chapter_sources(
            project_root, target_absolute, prompt_bundle, snapshot=snapshot, user_message=request.user_message
        )
        seed = build_brief_seed(
            user_message=request.user_message,
            target_path=target_relative,
            planned=planned,
            plan=plan,
        )
        context = ToolExecutionContext(
            request.session,
            request.run,
            request.agent_session_id,
            request.assistant_session_id,
            request.user_message,
            request.args,
        )
        started = base_response(
            agent_session_id=request.agent_session_id,
            assistant_session_id=request.assistant_session_id,
            intent=CHAPTER_WRITE_INTENT,
            user_message=request.user_message,
            plan=[
                plan_step("chapter.brief", "整理章节目标与可信上下文。", "running"),
                plan_step("chapter.brief.confirm", "等待作者确认 Chapter Brief。", "pending"),
                plan_step("chapter.draft", "按确认后的 brief 起草正文。", "pending"),
                plan_step("chapter.check", "检查并在必要时定向修复一次。", "pending"),
                plan_step("chapter.patch", "生成待审阅 proposed patch。", "pending"),
            ],
            agent_result={"summary": "正在整理 Chapter Brief。", "requires_user_confirmation": False},
            tool_trace=[],
            role_hints=role_hints(request.args),
            role_mentions=role_mentions(request.args),
        )
        self._event_sink.record_plan(request.run, started)
        brief_result = self._execute_tool(
            "chapter.brief",
            context,
            {
                "project_root": project_root,
                "target_absolute": target_absolute,
                "seed": seed,
                "llm_context_snapshot": snapshot,
                "llm_prompt_context_bundle": prompt_bundle,
            },
        )
        assert_chapter_sources(project_root, target_absolute, source_guard)
        self._event_sink.record_tool_trace(request.run, brief_result.trace, 0)
        brief = brief_result.output["brief"]
        safe_prompt_bundle = self._safe_prompt_bundle(prompt_bundle)
        pending_payload = {
            "kind": RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            "intent": CHAPTER_WRITE_INTENT,
            "boundary": "after_tool:chapter.brief",
            "status": "pending",
            "resume_strategy": "continue_chapter_writing_after_brief",
            "resume_message": {
                "type": "user_message",
                "intent": CHAPTER_WRITE_INTENT,
                "user_message": request.user_message,
                "assistant_session_id": request.assistant_session_id,
                "args": {
                    "project_path": project_root,
                    "project_name": request.args.get("project_name"),
                    "file_path": target_relative,
                    "context_bundle": safe_prompt_bundle,
                },
            },
            "chapter_brief": brief,
            "target_relative": target_relative,
            "source_guard": source_guard,
            "llm_prompt_context_bundle": safe_prompt_bundle,
        }
        self._event_sink.record_runtime_pending_call(request.run, payload=pending_payload)
        summary = f"Chapter Brief 已准备：{brief.get('goal') or target_relative}。确认后才会开始起草。"
        result = base_response(
            agent_session_id=request.agent_session_id,
            assistant_session_id=request.assistant_session_id,
            intent=CHAPTER_WRITE_INTENT,
            user_message=request.user_message,
            plan=[
                plan_step("chapter.brief", "已生成可编辑 Chapter Brief。", "completed"),
                plan_step("chapter.brief.confirm", "等待作者确认 Chapter Brief。", "needs_approval"),
                plan_step("chapter.draft", "确认后起草正文。", "pending"),
                plan_step("chapter.check", "检查并在必要时定向修复一次。", "pending"),
                plan_step("chapter.patch", "检查通过后生成 proposed patch。", "pending"),
            ],
            agent_result={
                "summary": summary,
                "requires_user_confirmation": True,
                "confirmation_kind": "chapter_brief",
                "chapter_brief": brief,
                "confirmation_action": {"kind": "chapter_brief", "chapter_brief": brief},
            },
            tool_trace=[brief_result.trace],
            role_hints=role_hints(request.args),
            role_mentions=role_mentions(request.args),
        )
        interrupted = check_result_delivery(result, boundary="before_finalize:chapter.brief", events_recorded=True)
        self._event_sink.record_artifact(
            request.run,
            kind=CHAPTER_BRIEF_ARTIFACT_KIND,
            payload={**brief, "status": "interrupted" if interrupted is not None else "proposed"},
            requires_confirmation=interrupted is None,
        )
        if interrupted is not None:
            return interrupted
        assistant_service.append_assistant_message(
            request.session,
            request.assistant_session_id,
            AssistantMessageCreate(role="user", content=request.user_message),
        )
        assistant_service.append_assistant_message(
            request.session,
            request.assistant_session_id,
            AssistantMessageCreate(role="assistant", content=summary),
        )
        self._event_sink.record_permission_required(
            request.run,
            result,
            reason="chapter_brief_confirmation",
        )
        request.run.current_step = "chapter.brief.confirm"
        request.session.add(request.run)
        request.session.commit()
        interrupted = runtime_interrupted_response(
            result,
            {
                "kind": "runtime_interruption",
                "status": "paused",
                "current_step": "chapter.brief.confirm",
                "boundary": "after_tool:chapter.brief",
                "uses_existing_status": True,
                "resume_strategy": "continue_chapter_writing_after_brief",
                "automatic_resume_supported": True,
            },
            events_recorded=True,
        )
        interrupted["agent_result"]["requires_user_confirmation"] = True
        return interrupted

    def _resume_chapter_writing(self, request: FixedPipelineRequest, pending: AgentArtifact) -> dict[str, Any]:
        payload = pending.payload if isinstance(pending.payload, dict) else {}
        original_brief = payload.get("chapter_brief") if isinstance(payload.get("chapter_brief"), dict) else {}
        confirmed = confirm_brief(request.args.get("chapter_brief"), original_brief)
        project_root = self._resume_project_root(request)
        target_relative, target_absolute, _planned = resolve_target(project_root, confirmed["target_path"])
        if target_relative != payload.get("target_relative"):
            raise AgentOrchestrationError("目标章节在 brief 确认期间发生变化，请重新生成 brief。")
        prompt_bundle = payload.get("llm_prompt_context_bundle")
        if not isinstance(prompt_bundle, dict):
            raise AgentOrchestrationError("Chapter Brief 缺少可信上下文快照，请重新生成。")
        assert_chapter_sources(project_root, target_absolute, payload.get("source_guard"))
        context = ToolExecutionContext(
            request.session,
            request.run,
            request.agent_session_id,
            request.assistant_session_id,
            request.user_message,
            request.args,
        )
        traces: list[AgentToolTrace] = []
        draft = self._execute_tool(
            "chapter.draft",
            context,
            {
                "project_root": project_root,
                "project_name": request.args.get("project_name"),
                "target_absolute": target_absolute,
                "target_relative": target_relative,
                "brief": confirmed,
                "source_guard": payload["source_guard"],
                "llm_prompt_context_bundle": prompt_bundle,
            },
        )
        traces.append(draft.trace)
        content = str(draft.output["content"])
        check = self._execute_tool("chapter.check", context, {"brief": confirmed, "content": content, "attempt": 1})
        traces.append(check.trace)
        final_check = check.output["check"]
        repair_count = 0
        if final_check["status"] == "repairable":
            repaired = self._execute_tool(
                "chapter.repair",
                context,
                {
                    "project_root": project_root,
                    "project_name": request.args.get("project_name"),
                    "target_absolute": target_absolute,
                    "brief": confirmed,
                    "content": content,
                    "check": final_check,
                    "source_guard": payload["source_guard"],
                    "llm_prompt_context_bundle": prompt_bundle,
                },
            )
            traces.append(repaired.trace)
            content = str(repaired.output["content"])
            repair_count = 1
            check = self._execute_tool("chapter.check", context, {"brief": confirmed, "content": content, "attempt": 2})
            traces.append(check.trace)
            final_check = check.output["check"]
        assert_chapter_sources(project_root, target_absolute, payload.get("source_guard"))
        for index, trace in enumerate(traces):
            self._event_sink.record_tool_trace(request.run, trace, index)
        tool_artifacts = [
            ToolArtifact(kind=CHAPTER_BRIEF_ARTIFACT_KIND, payload=confirmed),
            ToolArtifact(
                kind=CHAPTER_CHECK_ARTIFACT_KIND,
                payload={**final_check, "attempt": 2 if repair_count else 1, "repair_count": repair_count},
            ),
            runtime_pending_call_resolution_artifact(pending),
        ]
        if final_check["status"] != "pass":
            execution_status = final_check["execution_status"]
            if execution_status == "completed":
                detail = f"章节检查已完成：发现 {final_check['manuscript_hard_failure_count']} 个稿件硬失败。"
            elif execution_status == "incomplete":
                detail = "章节检查未完整执行：结果超过协议预算，不能据此判断稿件通过。"
            else:
                detail = "章节检查执行失败：未取得有效、来源与证据可核实的完整结果。"
            summary = f"{detail} 候选稿已保留在运行证据中，未生成补丁。"
            candidate = {
                "target_path": target_relative,
                "brief_id": confirmed["brief_id"],
                "brief_sha256": final_check["brief_sha256"],
                "content": content,
                "content_sha256": final_check["content_sha256"],
                "execution_status": execution_status,
                "manuscript_status": final_check["manuscript_status"],
                "read_only": True,
            }
            tool_artifacts.append(ToolArtifact(kind=CHAPTER_CANDIDATE_ARTIFACT_KIND, payload=candidate))
            result = base_response(
                agent_session_id=request.agent_session_id,
                assistant_session_id=request.assistant_session_id,
                intent=CHAPTER_WRITE_INTENT,
                user_message=request.user_message,
                plan=self._completed_plan(
                    check_status="completed" if execution_status == "completed" else "failed",
                    patch_status="skipped",
                    check_detail=detail,
                ),
                agent_result={
                    "summary": summary,
                    "requires_user_confirmation": False,
                    "chapter_brief": confirmed,
                    "chapter_check": final_check,
                    "chapter_candidate": candidate,
                    "repair_count": repair_count,
                },
                tool_trace=traces,
                role_hints=role_hints(request.args),
                role_mentions=role_mentions(request.args),
                tool_artifacts=tool_artifacts,
            )
            result["_events_recorded"] = True
            return result
        requires_confirmation = patch_requires_confirmation(request.run.permission_profile)
        proposed_patch = {
            "id": f"chapter-writing-{uuid.uuid4().hex}",
            "kind": "file_revision",
            "created_by_tool": CHAPTER_WRITE_INTENT,
            "file_path": target_absolute,
            "before": "",
            "after": content,
            "requires_confirmation": requires_confirmation,
            "approval_action": "desktop.confirm_file_writeback",
            "brief_id": confirmed["brief_id"],
        }
        tool_artifacts.append(
            ToolArtifact(kind="proposed_patch", payload=proposed_patch, requires_confirmation=requires_confirmation)
        )
        summary = f"章节草稿已通过 brief 检查，生成 {target_relative} 的待审阅补丁。"
        result = base_response(
            agent_session_id=request.agent_session_id,
            assistant_session_id=request.assistant_session_id,
            intent=CHAPTER_WRITE_INTENT,
            user_message=request.user_message,
            plan=self._completed_plan(check_status="completed", patch_status="completed"),
            agent_result={
                "summary": summary,
                "requires_user_confirmation": requires_confirmation,
                "chapter_brief": confirmed,
                "chapter_check": final_check,
                "repair_count": repair_count,
            },
            tool_trace=traces,
            proposed_patch=proposed_patch,
            role_hints=role_hints(request.args),
            role_mentions=role_mentions(request.args),
            tool_artifacts=tool_artifacts,
        )
        result["_events_recorded"] = True
        return result

    @staticmethod
    def _is_chapter_resume(run: AgentRun, pending: AgentArtifact | None) -> bool:
        if pending is None or run.status != "running" or run.current_step != "resumed":
            return False
        payload = pending.payload if isinstance(pending.payload, dict) else {}
        return payload.get("intent") == CHAPTER_WRITE_INTENT

    @staticmethod
    def _required_project_root(args: Mapping[str, Any]) -> str:
        value = args.get("project_path")
        if not isinstance(value, str) or not value.strip():
            raise AgentOrchestrationError("写一章需要当前项目路径。")
        return value.strip()

    def _resume_project_root(self, request: FixedPipelineRequest) -> str:
        value = request.args.get("project_path")
        if isinstance(value, str) and value.strip():
            return value.strip()
        assistant_session = assistant_service.get_assistant_session(request.session, request.assistant_session_id)
        project_path = getattr(assistant_session, "project_path", None)
        if isinstance(project_path, str) and project_path.strip():
            return project_path.strip()
        raise AgentOrchestrationError("恢复写章时找不到当前项目路径，请重新发起写章。")

    @staticmethod
    def _safe_prompt_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
        safe = dict(bundle)
        safe["project_root"] = "."
        return safe

    @staticmethod
    def _completed_plan(
        *, check_status: str, patch_status: str, check_detail: str = "章节检查已完成。"
    ) -> list[dict[str, str]]:
        return [
            plan_step("chapter.brief", "作者已确认 Chapter Brief。", "completed"),
            plan_step("chapter.brief.confirm", "Chapter Brief 已确认。", "completed"),
            plan_step("chapter.draft", "已按 brief 起草正文。", "completed"),
            plan_step("chapter.check", check_detail, check_status),
            plan_step("chapter.patch", "仅检查通过时生成 proposed patch。", patch_status),
        ]


__all__ = ["ChapterWritingRuntimeMixin"]
