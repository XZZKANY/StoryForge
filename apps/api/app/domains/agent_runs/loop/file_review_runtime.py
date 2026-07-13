from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs.events.runtime_support import base_response as _base_response
from app.domains.agent_runs.events.runtime_support import file_review_resume_message as _file_review_resume_message
from app.domains.agent_runs.events.runtime_support import json_safe_review_output as _json_safe_review_output
from app.domains.agent_runs.events.runtime_support import latest_runtime_pending_call as _latest_runtime_pending_call
from app.domains.agent_runs.events.runtime_support import plan_step as _plan_step
from app.domains.agent_runs.events.runtime_support import runtime_interrupted_response as _runtime_interrupted_response
from app.domains.agent_runs.events.runtime_support import (
    runtime_pending_call_resolution_artifact as _runtime_pending_call_resolution_artifact,
)
from app.domains.agent_runs.events.runtime_support import should_resume_file_review as _should_resume_file_review
from app.domains.agent_runs.events.runtime_support import trace_objects as _trace_objects
from app.domains.agent_runs.intent import role_hints as _role_hints
from app.domains.agent_runs.intent import role_mentions as _role_mentions
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
from app.domains.agent_runs.tools import ToolArtifact, ToolExecutionContext
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantMessageCreate


class FileReviewRuntimeMixin:
    def _run_file_review_interruptible(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        pending_call = _latest_runtime_pending_call(session, run)
        if _should_resume_file_review(run, pending_call):
            return self._resume_file_review_from_pending_call(
                session,
                run=run,
                agent_session_id=agent_session_id,
                assistant_session_id=assistant_session_id,
                user_message=user_message,
                args=args,
                pending_call=pending_call,
            )

        plan_started = [
            _plan_step("context.load", "读取当前章与项目上下文。", "running"),
            _plan_step("subagents.review", "剧情、人物、文风和连续性子代理完成同步审稿。", "pending"),
            _plan_step("synthesizer.merge", "合并多视角意见为结构化审稿报告。", "pending"),
        ]
        started = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="file.review",
            user_message=user_message,
            plan=plan_started,
            agent_result={"summary": "正在读取当前章与项目上下文。", "requires_user_confirmation": False},
            tool_trace=[],
            runtime_mode="agent_runtime",
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )
        self._event_sink.record_plan(run, started)
        interruption = self._runtime_interruption(run, boundary="after_plan")
        if interruption is not None:
            return _runtime_interrupted_response(started, interruption, events_recorded=True)

        context = self._execute_tool(
            "context.load",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            {**args, "_agent_intent": "file.review"},
        )
        self._event_sink.record_tool_trace(run, context.trace, 0)
        plan_after_context = [
            _plan_step("context.load", "读取当前章与项目上下文。", "completed"),
            _plan_step("subagents.review", "剧情、人物、文风和连续性子代理完成同步审稿。", "pending"),
            _plan_step("synthesizer.merge", "合并多视角意见为结构化审稿报告。", "pending"),
        ]
        partial = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="file.review",
            user_message=user_message,
            plan=plan_after_context,
            agent_result={"summary": "已读取上下文，等待继续审稿。", "requires_user_confirmation": False},
            tool_trace=[context.trace],
            runtime_mode="agent_runtime",
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )
        interruption = self._runtime_interruption(run, boundary="after_tool:context.load")
        if interruption is not None:
            self._record_file_review_pending_call(run, partial=partial, context_output=context.output, interruption=interruption)
            return _runtime_interrupted_response(partial, interruption, events_recorded=True)

        review = self._execute_tool(
            "file.review",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            {**args, **context.output},
        )
        traces = [context.trace, *review.output["traces"]]
        review_report = review.output["review_report"]
        summary = review.output["summary"]
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
        result = _base_response(
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
        for index, trace in enumerate(review.output["traces"], start=1):
            self._event_sink.record_tool_trace(run, trace, index)
            interruption = self._runtime_interruption(run, boundary=f"after_tool:{trace.tool_name}")
            if interruption is not None:
                self._record_file_review_pending_call(
                    run,
                    partial=result,
                    context_output=context.output,
                    interruption=interruption,
                    review_output=review.output,
                    next_trace_index=index + 1,
                )
                return _runtime_interrupted_response(result, interruption, events_recorded=True)
        result["_events_recorded"] = True
        return result

    def _resume_file_review_from_pending_call(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
        pending_call: AgentArtifact,
    ) -> dict[str, Any]:
        payload = pending_call.payload if isinstance(pending_call.payload, dict) else {}
        context_output = payload.get("context_output") if isinstance(payload.get("context_output"), dict) else {}
        context_trace_payload = payload.get("context_trace") if isinstance(payload.get("context_trace"), dict) else {}
        context_trace = _trace_objects({"tool_trace": [context_trace_payload]})
        review_output = payload.get("review_output") if isinstance(payload.get("review_output"), dict) else None
        if review_output is not None:
            return self._resume_file_review_postprocess_from_pending_call(
                session,
                run=run,
                agent_session_id=agent_session_id,
                assistant_session_id=assistant_session_id,
                user_message=user_message,
                args=args,
                pending_call=pending_call,
                payload=payload,
                context_trace=context_trace,
                review_output=review_output,
            )
        review = self._execute_tool(
            "file.review",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            {**args, **context_output},
        )
        traces = [*context_trace, *review.output["traces"]]
        review_report = review.output["review_report"]
        summary = review.output["summary"]
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
        result = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="file.review",
            user_message=user_message,
            plan=[
                _plan_step("context.load", "读取当前章与项目上下文。", "completed"),
                _plan_step("subagents.review", "从 pending boundary 继续，多视角审稿完成。", "completed"),
                _plan_step("synthesizer.merge", "合并多视角意见为结构化审稿报告。", "completed"),
            ],
            agent_result={
                "summary": summary,
                "requires_user_confirmation": False,
                "review_report": review_report,
                "resumed_from_pending_call": True,
                "pending_call_artifact_id": pending_call.id,
            },
            tool_trace=traces,
            runtime_mode="agent_runtime",
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
            tool_artifacts=[*review.artifacts, _runtime_pending_call_resolution_artifact(pending_call)],
        )
        for index, trace in enumerate(review.output["traces"], start=1):
            self._event_sink.record_tool_trace(run, trace, index)
            interruption = self._runtime_interruption(run, boundary=f"after_tool:{trace.tool_name}")
            if interruption is not None:
                return _runtime_interrupted_response(result, interruption, events_recorded=True)
        result["_events_recorded"] = True
        return result

    def _resume_file_review_postprocess_from_pending_call(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
        pending_call: AgentArtifact,
        payload: dict[str, Any],
        context_trace: list[AgentToolTrace],
        review_output: dict[str, Any],
    ) -> dict[str, Any]:
        review_report = review_output["review_report"]
        summary = review_output["summary"]
        review_traces = _trace_objects({"tool_trace": review_output.get("traces")})
        traces = [*context_trace, *review_traces]
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
        result = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="file.review",
            user_message=user_message,
            plan=[
                _plan_step("context.load", "读取当前章与项目上下文。", "completed"),
                _plan_step("subagents.review", "从 pending boundary 继续，补齐剩余审稿事件。", "completed"),
                _plan_step("synthesizer.merge", "合并多视角意见为结构化审稿报告。", "completed"),
            ],
            agent_result={
                "summary": summary,
                "requires_user_confirmation": False,
                "review_report": review_report,
                "resumed_from_pending_call": True,
                "pending_call_artifact_id": pending_call.id,
                "resumed_from_boundary": payload.get("boundary"),
            },
            tool_trace=traces,
            runtime_mode="agent_runtime",
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
            tool_artifacts=[
                ToolArtifact(kind="review_report", payload=review_report, requires_confirmation=False),
                _runtime_pending_call_resolution_artifact(pending_call),
            ],
        )
        next_trace_index = payload.get("next_trace_index")
        start_index = next_trace_index if isinstance(next_trace_index, int) and next_trace_index > 0 else 1
        for index, trace in enumerate(review_traces[start_index - 1 :], start=start_index):
            self._event_sink.record_tool_trace(run, trace, index)
            interruption = self._runtime_interruption(run, boundary=f"after_tool:{trace.tool_name}")
            if interruption is not None:
                self._record_file_review_pending_call(
                    run,
                    partial=result,
                    context_output=payload.get("context_output") if isinstance(payload.get("context_output"), dict) else {},
                    interruption=interruption,
                    review_output=review_output,
                    next_trace_index=index + 1,
                )
                return _runtime_interrupted_response(result, interruption, events_recorded=True)
        result["_events_recorded"] = True
        return result

    def _record_file_review_pending_call(
        self,
        run: AgentRun,
        *,
        partial: dict[str, Any],
        context_output: dict[str, Any],
        interruption: dict[str, Any],
        review_output: dict[str, Any] | None = None,
        next_trace_index: int | None = None,
    ) -> None:
        if interruption.get("status") != "paused":
            return
        boundary = interruption.get("boundary")
        if not isinstance(boundary, str) or not boundary:
            boundary = "after_tool:context.load"
        payload = {
            "kind": RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            "intent": "file.review",
            "boundary": boundary,
            "status": "pending",
            "resume_message": _file_review_resume_message(partial),
            "context_output": context_output,
            "context_trace": partial["tool_trace"][0] if partial.get("tool_trace") else None,
            "interruption": interruption,
            "resume_strategy": "continue_after_context_load"
            if boundary == "after_tool:context.load"
            else "continue_file_review_postprocess",
        }
        if review_output is not None:
            payload["review_output"] = _json_safe_review_output(review_output)
        if next_trace_index is not None:
            payload["next_trace_index"] = next_trace_index
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
