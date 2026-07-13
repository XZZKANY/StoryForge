from __future__ import annotations

from typing import Any, Protocol

from sqlalchemy.orm import Session

from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.events import runtime_support as runtime_event_support
from app.domains.agent_runs.fs.runtime_tools import FsRuntimeToolsMixin
from app.domains.agent_runs.intent import SUPPORTED_INTENTS  # noqa: F401
from app.domains.agent_runs.intent import detect_intent as _detect_intent
from app.domains.agent_runs.intent import message_args as _message_args
from app.domains.agent_runs.intent import message_text as _message_text
from app.domains.agent_runs.intent import role_hints as _role_hints
from app.domains.agent_runs.intent import role_mentions as _role_mentions
from app.domains.agent_runs.loop.chapter_generation_runtime import ChapterGenerationRuntimeMixin
from app.domains.agent_runs.loop.chapter_review_runtime import ChapterReviewRuntimeMixin
from app.domains.agent_runs.loop.conversation_runtime import ConversationRuntimeMixin
from app.domains.agent_runs.loop.file_review_runtime import FileReviewRuntimeMixin
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.patches.runtime_tools import PatchRuntimeToolsMixin
from app.domains.agent_runs.permission import PermissionGate
from app.domains.agent_runs.review_report import (
    build_multi_agent_review_report_with_executor as _build_multi_agent_review_report_with_executor,
)
from app.domains.agent_runs.review_report import continuity_subagent_handler as _continuity_subagent_handler
from app.domains.agent_runs.review_report import review_report_summary as _review_report_summary
from app.domains.agent_runs.review_report import review_subagent_handler as _review_subagent_handler
from app.domains.agent_runs.tools import (
    SubagentDefinition,
    SubagentExecutor,
    ToolArtifact,
    ToolExecutionContext,
    ToolRegistry,
    ToolResult,
    runtime_arguments,
)
from app.domains.agent_runs.tools.execution_runtime import ToolExecutionRuntimeMixin
from app.domains.agent_runs.tools.project_canon_runtime import ProjectCanonRuntimeMixin
from app.domains.agent_runs.tools.project_checks_runtime import ProjectChecksRuntimeMixin
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.ide.orchestrator import orchestrate_agent_message  # noqa: F401

_resolve_assistant_session = runtime_event_support.resolve_assistant_session
_base_response = runtime_event_support.base_response
_trace_objects = runtime_event_support.trace_objects
_latest_runtime_pending_call = runtime_event_support.latest_runtime_pending_call
_should_resume_file_review = runtime_event_support.should_resume_file_review
_should_resume_runtime_pending_call = runtime_event_support.should_resume_runtime_pending_call
_file_review_resume_message = runtime_event_support.file_review_resume_message
_chapter_review_resume_message = runtime_event_support.chapter_review_resume_message
_runtime_pending_call_resolution_artifact = runtime_event_support.runtime_pending_call_resolution_artifact
_json_safe_review_output = runtime_event_support.json_safe_review_output
_tool_artifacts_from_result = runtime_event_support.tool_artifacts_from_result
_result_requires_confirmation = runtime_event_support.result_requires_confirmation
_runtime_interrupted_response = runtime_event_support.runtime_interrupted_response
_runtime_interruption_summary = runtime_event_support.runtime_interruption_summary
_pop_runtime_internal_markers = runtime_event_support.pop_runtime_internal_markers
_plan_step = runtime_event_support.plan_step
_fs_int_arg = runtime_arguments.fs_int_arg
_chat_context_block = runtime_arguments.chat_context_block
_required_string = runtime_arguments.required_string
_required_int = runtime_arguments.required_int
_optional_positive_int = runtime_arguments.optional_positive_int
_optional_int = runtime_arguments.optional_int
_trim_prose_instruction = runtime_arguments.trim_prose_instruction
_safe_summary = runtime_arguments.safe_summary
_llm_context_input_summary = runtime_arguments.llm_context_input_summary
_judge_run_args_from_scene_packet = runtime_arguments.judge_run_args_from_scene_packet
_string_list = runtime_arguments.string_list
_dict_list = runtime_arguments.dict_list
_style_rules = runtime_arguments.style_rules
_payload_list = runtime_arguments.payload_list
_can_repair_issue = runtime_arguments.can_repair_issue
_first_patch_payload = runtime_arguments.first_patch_payload
_proposed_patch_from_repair_patch = runtime_arguments.proposed_patch_from_repair_patch


class EventSink(Protocol):
    def record_plan(self, run: AgentRun, result: dict[str, Any]) -> None: ...

    def record_tool_trace(self, run: AgentRun, trace: AgentToolTrace, index: int) -> None: ...

    def record_artifact(self, run: AgentRun, *, kind: str, payload: dict[str, Any], requires_confirmation: bool) -> None: ...

    def record_permission_required(self, run: AgentRun, result: dict[str, Any], *, reason: str) -> None: ...

    def runtime_interruption(self, run: AgentRun, *, boundary: str) -> dict[str, Any] | None: ...

    def record_runtime_pending_call(self, run: AgentRun, *, payload: dict[str, Any]) -> None: ...

    def record_system_job(
        self,
        run: AgentRun,
        *,
        key: str,
        payload: dict[str, Any],
        artifact_kind: str | None = None,
        artifact_payload: dict[str, Any] | None = None,
    ) -> None: ...

    def complete(self, run: AgentRun, result: dict[str, Any]) -> None: ...

    def fail(self, run: AgentRun, *, message: str, payload: dict[str, Any] | None = None) -> None: ...


class AgentRuntime(
    ConversationRuntimeMixin,
    FileReviewRuntimeMixin,
    ChapterGenerationRuntimeMixin,
    ChapterReviewRuntimeMixin,
    ToolExecutionRuntimeMixin,
    FsRuntimeToolsMixin,
    ProjectChecksRuntimeMixin,
    ProjectCanonRuntimeMixin,
    PatchRuntimeToolsMixin,
):
    """Root Agent runtime facade: skill plan -> tool registry -> permission gate -> event store."""

    def __init__(self, event_sink: EventSink) -> None:
        self._event_sink = event_sink
        self._permission_gate = PermissionGate()
        self._tool_registry = ToolRegistry()
        self._subagents = SubagentExecutor(
            [
                SubagentDefinition("plot_reviewer", {}, {}, _review_subagent_handler("plot")),
                SubagentDefinition("character_reviewer", {}, {}, _review_subagent_handler("character")),
                SubagentDefinition("prose_reviewer", {}, {}, _review_subagent_handler("prose")),
                SubagentDefinition("continuity_reviewer", {}, {}, _continuity_subagent_handler),
            ]
        )
        self._register_tools()

    def run_user_message(self, session: Session, *, run: AgentRun, agent_session_id: str, message: dict[str, Any]) -> dict[str, Any]:
        user_message = _message_text(message)
        args = _message_args(message)
        intent = _detect_intent(user_message, args, message.get("intent"))
        # 项目级对话解绑当前文件：需要文件的 intent 若没带 file_path，降级为对话，
        # 避免 context.load 因缺文件而崩（P1「对话统领项目」）。
        # 只看 file_path：resume 重建的消息只回传 file_path（正文靠 pending call 续跑），
        # 若一并要求 content 会把 file.review 的 resume 误降级成 chat.explain。
        if intent in ("file.review", "file.revise") and _optional_string(args.get("file_path")) is None:
            intent = "chat.explain"
        try:
            assistant_session = _resolve_assistant_session(session, user_message=user_message, message=message, args=args)
            if intent == "chat.explain":
                result = self._run_chat_explain(
                    session,
                    run=run,
                    agent_session_id=agent_session_id,
                    assistant_session_id=assistant_session.id,
                    user_message=user_message,
                    args=args,
                )
            elif intent == "file.review":
                result = self._run_file_review_interruptible(
                    session,
                    run=run,
                    agent_session_id=agent_session_id,
                    assistant_session_id=assistant_session.id,
                    user_message=user_message,
                    args=args,
                )
            elif intent == "file.revise":
                result = self._run_chapter_polish(
                    session,
                    run=run,
                    agent_session_id=agent_session_id,
                    assistant_session_id=assistant_session.id,
                    user_message=user_message,
                    args=args,
                    intent=intent,
                )
            elif intent == "bookrun.start":
                result = self._run_bookrun_generation(
                    session,
                    run=run,
                    agent_session_id=agent_session_id,
                    assistant_session_id=assistant_session.id,
                    user_message=user_message,
                    args=args,
                )
            elif intent == "chapter.review":
                result = self._run_chapter_review(
                    session,
                    run=run,
                    agent_session_id=agent_session_id,
                    assistant_session_id=assistant_session.id,
                    user_message=user_message,
                    args=args,
                )
            elif intent == "chapter.repair":
                result = self._run_chapter_review_repair(
                    session,
                    run=run,
                    agent_session_id=agent_session_id,
                    assistant_session_id=assistant_session.id,
                    user_message=user_message,
                    args=args,
                )
            else:
                raise AgentOrchestrationError(f"暂不支持的 Agent intent：{intent}")
        except AgentOrchestrationError as exc:
            self._event_sink.fail(
                run,
                message=str(exc),
                payload={"session_id": agent_session_id, "run_id": run.public_id, "runtime": "agent_runtime"},
            )
            raise
        except Exception as exc:  # noqa: BLE001 - runtime must persist a failed run before surfacing errors
            self._event_sink.fail(
                run,
                message=str(exc),
                payload={"session_id": agent_session_id, "run_id": run.public_id, "runtime": "agent_runtime"},
            )
            raise AgentOrchestrationError(str(exc)) from exc

        result["run_id"] = run.public_id
        result.setdefault("agent_role_hints", _role_hints(args))
        result.setdefault("agent_role_mentions", _role_mentions(args))
        if result.get("_events_recorded") is True:
            if result.get("_runtime_interrupted") is True:
                _pop_runtime_internal_markers(result)
                return result
            self._record_result_artifacts(run, result)
            self._run_hidden_system_jobs(session, run=run, assistant_session_id=assistant_session.id, result=result)
            if _result_requires_confirmation(result):
                self._event_sink.record_permission_required(run, result, reason="requires_user_confirmation")
                result.setdefault("agent_result", {})["writeback_blocked_until_user_confirms"] = True
                _pop_runtime_internal_markers(result)
                return result
            self._event_sink.complete(run, result)
            _pop_runtime_internal_markers(result)
            return result
        self._event_sink.record_plan(run, result)
        interruption = self._runtime_interruption(run, boundary="after_plan")
        if interruption is not None:
            return _runtime_interrupted_response(result, interruption)
        for index, trace in enumerate(_trace_objects(result)):
            self._event_sink.record_tool_trace(run, trace, index)
            interruption = self._runtime_interruption(run, boundary=f"after_tool:{trace.tool_name}")
            if interruption is not None:
                return _runtime_interrupted_response(result, interruption)
        self._record_result_artifacts(run, result)
        self._run_hidden_system_jobs(session, run=run, assistant_session_id=assistant_session.id, result=result)
        if _result_requires_confirmation(result):
            self._event_sink.record_permission_required(run, result, reason="requires_user_confirmation")
            result.setdefault("agent_result", {})["writeback_blocked_until_user_confirms"] = True
            return result
        self._event_sink.complete(run, result)
        return result

    def _file_review(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = _required_string(payload, "content")
        context_bundle = payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else None
        prompt_context_bundle = (
            payload.get("llm_prompt_context_bundle") if isinstance(payload.get("llm_prompt_context_bundle"), dict) else context_bundle
        )
        report, traces = _build_multi_agent_review_report_with_executor(
            self._subagents,
            file_path=file_path,
            content=content,
            context_bundle=prompt_context_bundle,
            user_message=_context.user_message,
            requested_role_hints=_role_hints(_context.args),
            requested_role_mentions=_role_mentions(_context.args),
        )
        summary = _review_report_summary(report)
        return ToolResult(
            status="completed",
            output={"review_report": report, "summary": summary, "traces": traces},
            summary=summary,
            payload={"review_report": report},
            artifacts=(ToolArtifact(kind="review_report", payload=report, requires_confirmation=False),),
            metrics={"issue_count": len(report["issues"]), "mode": report["mode"]},
            trace=AgentToolTrace(
                tool_name="file.review",
                status="completed",
                input_summary={
                    "file_path": file_path,
                    "content_chars": len(content),
                    **_llm_context_input_summary(payload.get("llm_context_snapshot")),
                },
                output_summary={"issue_count": len(report["issues"]), "mode": report["mode"]},
            ),
        )
