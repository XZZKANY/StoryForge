from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs.adapters.intent_fixed_pipeline_adapter import FixedPipelineRequest
from app.domains.agent_runs.bookrun_summary import bookrun_budget_details as _bookrun_budget_details
from app.domains.agent_runs.bookrun_summary import bookrun_budget_summary as _bookrun_budget_summary
from app.domains.agent_runs.bookrun_summary import bookrun_chapter_plan_summary as _bookrun_chapter_plan_summary
from app.domains.agent_runs.bookrun_summary import bookrun_risk_summary as _bookrun_risk_summary
from app.domains.agent_runs.events.runtime_support import base_response as _base_response
from app.domains.agent_runs.events.runtime_support import (
    chapter_review_resume_message as _chapter_review_resume_message,
)
from app.domains.agent_runs.events.runtime_support import plan_step as _plan_step
from app.domains.agent_runs.intent import role_hints as _role_hints
from app.domains.agent_runs.intent import role_mentions as _role_mentions
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
from app.domains.agent_runs.tools import ToolExecutionContext
from app.domains.agent_runs.tools.runtime_arguments import required_int as _required_int
from app.domains.agent_runs.tools.runtime_arguments import safe_summary as _safe_summary
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantMessageCreate


class ChapterGenerationRuntimeMixin:
    def run_chapter_polish_pipeline(self, request: FixedPipelineRequest) -> dict[str, Any]:
        return self._run_chapter_polish(
            request.session,
            run=request.run,
            agent_session_id=request.agent_session_id,
            assistant_session_id=request.assistant_session_id,
            user_message=request.user_message,
            args=request.args,
            intent=request.intent,
        )

    def run_bookrun_generation_pipeline(self, request: FixedPipelineRequest) -> dict[str, Any]:
        return self._run_bookrun_generation(
            request.session,
            run=request.run,
            agent_session_id=request.agent_session_id,
            assistant_session_id=request.assistant_session_id,
            user_message=request.user_message,
            args=request.args,
        )

    def _record_chapter_review_pending_call(
        self,
        run: AgentRun,
        *,
        partial: dict[str, Any],
        scene_packet_id: int,
        judge_output: dict[str, Any],
        interruption: dict[str, Any],
    ) -> None:
        if interruption.get("status") != "paused":
            return
        boundary = interruption.get("boundary")
        if not isinstance(boundary, str) or not boundary:
            boundary = "after_tool:judge.run"
        payload = {
            "kind": RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            "intent": "chapter.review",
            "boundary": boundary,
            "status": "pending",
            "resume_message": _chapter_review_resume_message(partial, scene_packet_id=scene_packet_id),
            "judge_output": judge_output,
            "judge_trace": partial["tool_trace"][0] if partial.get("tool_trace") else None,
            "interruption": interruption,
            "resume_strategy": "continue_chapter_review_postprocess",
        }
        recorder = getattr(self._event_sink, "record_runtime_pending_call", None)
        if callable(recorder):
            recorder(run, payload=payload)
            return
        self._event_sink.record_artifact(
            run,
            kind=RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            payload=payload,
            requires_confirmation=False,
        )

    def _run_chapter_polish(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
        intent: str,
    ) -> dict[str, Any]:
        context = self._execute_tool(
            "context.load",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            {**args, "_agent_intent": intent},
        )
        review = self._execute_tool(
            "file.review",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            {**args, **context.output},
        )
        traces = [context.trace, *review.output["traces"]]
        review_report = review.output["review_report"]
        summary = review.output["summary"]
        if intent == "file.review":
            assistant_service.append_assistant_message(
                session,
                assistant_session_id,
                AssistantMessageCreate(role="user", content=user_message),
            )
            assistant_service.append_assistant_message(
                session,
                assistant_session_id,
                AssistantMessageCreate(role="assistant", content=summary),
            )
            return _base_response(
                agent_session_id=agent_session_id,
                assistant_session_id=assistant_session_id,
                intent="file.review",
                user_message=user_message,
                plan=[
                    _plan_step("context.load", "读取当前章与项目上下文。", "completed"),
                    _plan_step("subagents.review", "剧情、人物、文风和连续性子代理完成同步审稿。", "completed"),
                    _plan_step("synthesizer.merge", "合并多视角意见为结构化审稿报告。", "completed"),
                ],
                agent_result={
                    "summary": summary,
                    "requires_user_confirmation": False,
                    "review_report": review_report,
                },
                tool_trace=traces,
                runtime_mode="agent_runtime",
                role_hints=_role_hints(args),
                role_mentions=_role_mentions(args),
                tool_artifacts=list(review.artifacts),
            )

        revise = self._execute_tool(
            "file.revise",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            {
                **args,
                "review_report": args.get("review_report") if isinstance(args.get("review_report"), dict) else review_report,
                "llm_context_snapshot": context.output.get("llm_context_snapshot"),
                "llm_prompt_context_bundle": context.output.get("llm_prompt_context_bundle"),
            },
        )
        traces.append(revise.trace)
        judge = self._execute_tool(
            "judge.run",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            {"content": revise.output["after"], "file_path": revise.output["file_path"], "mode": "proposed_patch_smoke"},
        )
        traces.append(judge.trace)
        proposed_patch = revise.output["proposed_patch"]
        revise_agent_result: dict[str, Any] = {
            "summary": revise.output["summary"],
            "requires_user_confirmation": True,
            "writeback_blocked_until_user_confirms": True,
            "applied_scope": revise.output["applied_scope"],
            "review_report": review_report,
        }
        if revise.output.get("scope_warning") is not None:
            revise_agent_result["scope_warning"] = revise.output["scope_warning"]
        return _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="file.revise",
            user_message=user_message,
            plan=[
                _plan_step("context.load", "读取当前章与项目上下文。", "completed"),
                _plan_step("subagents.review", "剧情、人物、文风和连续性子代理完成同步审稿。", "completed"),
                _plan_step("file.revise", "生成 Desktop PatchReviewPanel 可审阅的 proposed patch。", "completed"),
                _plan_step("judge.run", "对待确认修订执行轻量自检。", "completed"),
                _plan_step("permission.confirm", "文件写回前等待作者确认。", "needs_approval"),
            ],
            agent_result=revise_agent_result,
            tool_trace=traces,
            proposed_patch=proposed_patch,
            runtime_mode="agent_runtime",
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
            tool_artifacts=[*review.artifacts, *revise.artifacts],
        )

    def _run_bookrun_generation(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        command_args: dict[str, Any] = {
            "book_id": _required_int(args, "book_id"),
            "blueprint_id": _required_int(args, "blueprint_id"),
        }
        for key in ("token_budget", "time_budget_sec", "chapter_budget"):
            value = args.get(key)
            if isinstance(value, int) and value > 0:
                command_args[key] = value

        chapter_plan = _bookrun_chapter_plan_summary(command_args)
        budget_summary = _bookrun_budget_summary(command_args)
        structured_budget = _bookrun_budget_details(command_args)
        risk_summary = _bookrun_risk_summary(command_args)
        confirmed = args.get("confirmed") is True or args.get("user_confirmed") is True
        if not confirmed:
            summary = (
                f"写作任务启动前计划：{chapter_plan}。预算：{budget_summary}。"
                f"风险：{'；'.join(risk_summary)}。需要作者确认后才会以 managed 模式启动。"
            )
            assistant_service.append_assistant_message(
                session,
                assistant_session_id,
                AssistantMessageCreate(role="user", content=user_message),
            )
            assistant_service.append_assistant_message(
                session,
                assistant_session_id,
                AssistantMessageCreate(role="assistant", content=summary),
            )
            return _base_response(
                agent_session_id=agent_session_id,
                assistant_session_id=assistant_session_id,
                intent="bookrun.start",
                user_message=user_message,
                plan=[
                    _plan_step("bookrun.preflight", "展示写作任务章节计划、预算和风险，暂不启动。", "needs_approval"),
                    _plan_step("permission.confirm", "等待作者二次确认后再执行 bookrun.start。", "needs_approval"),
                ],
                agent_result={
                    "summary": summary,
                    "bookrun_plan": {
                        "chapters": chapter_plan,
                        "budget": budget_summary,
                        "budget_details": structured_budget,
                        "risk_summary": risk_summary,
                    },
                    "confirmation_required": True,
                    "confirmation_action": {"intent": "bookrun.start", "args": {**command_args, "confirmed": True}},
                    "requires_user_confirmation": True,
                },
                tool_trace=[
                    AgentToolTrace(
                        tool_name="bookrun.start",
                        status="needs_confirmation",
                        input_summary=_safe_summary(command_args),
                        output_summary={
                            "bookrun_plan": {
                                "chapters": chapter_plan,
                                "budget": budget_summary,
                                "budget_details": structured_budget,
                                "risk_summary": risk_summary,
                            }
                        },
                    )
                ],
                role_hints=_role_hints(args),
                role_mentions=_role_mentions(args),
            )

        execution = self._execute_tool(
            "bookrun.start",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            command_args,
        )
        result_payload = execution.output["result"]
        payload = result_payload.get("payload") if isinstance(result_payload.get("payload"), dict) else {}
        book_run = payload.get("book_run") if isinstance(payload.get("book_run"), dict) else {}
        writing_run = payload.get("writing_run") if isinstance(payload.get("writing_run"), dict) else {}
        book_run_id = payload.get("book_run_id") if isinstance(payload.get("book_run_id"), int) else book_run.get("id")
        writing_run_id = payload.get("writing_run_id") if isinstance(payload.get("writing_run_id"), int) else book_run_id
        events_url = f"/api/ide/runs/{book_run_id}/events" if isinstance(book_run_id, int) else None
        summary = (
            f"写作任务已以 managed 模式启动：run_id={writing_run_id}，状态 {book_run.get('status')}。"
            f"计划：{chapter_plan}。预算：{budget_summary}。进度会作为 Agent tool trace 返回，不切换主界面。"
        )
        assistant_service.append_assistant_message(
            session,
            assistant_session_id,
            AssistantMessageCreate(role="user", content=user_message),
        )
        assistant_service.append_assistant_message(
            session,
            assistant_session_id,
            AssistantMessageCreate(role="assistant", content=summary),
        )
        return _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="bookrun.start",
            user_message=user_message,
            plan=[
                _plan_step("bookrun.start", "通过 Tool Registry 启动 managed 写作任务。", "completed"),
                _plan_step("audit", "返回 command audit_event_id 供 IDE 追溯。", "completed"),
            ],
            agent_result={
                "summary": summary,
                "writing_run": writing_run,
                "writing_run_id": writing_run_id,
                "book_run": book_run,
                "book_run_id": book_run_id,
                "events_url": events_url,
                "bookrun_plan": {
                    "chapters": chapter_plan,
                    "budget": budget_summary,
                    "budget_details": structured_budget,
                    "risk_summary": risk_summary,
                },
                "requires_user_confirmation": False,
            },
            tool_trace=[execution.trace],
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )
