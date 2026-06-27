from __future__ import annotations

import uuid
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs._text import _compact_text, _optional_string
from app.domains.agent_runs.bookrun_summary import (
    _bookrun_budget_details,
    _bookrun_budget_summary,
    _bookrun_chapter_plan_summary,
    _bookrun_risk_summary,
)
from app.domains.agent_runs.intent import (
    SUPPORTED_INTENTS as SUPPORTED_INTENTS,
)
from app.domains.agent_runs.intent import (
    _detect_intent,
    _message_args,
    _message_text,
    _role_hints,
    _role_mentions,
)
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.review_report import (
    _build_multi_agent_review_report_with_executor,
    _continuity_subagent_handler,
    _review_report_summary,
    _review_subagent_handler,
)
from app.domains.agent_runs.revise_scope import (
    _public_revise_scope,
    _resolve_revise_scope,
    _revise_summary_with_scope,
    _scope_issues,
    _scope_warning,
    _scoped_revise_instruction,
)
from app.domains.agent_runs.system_jobs import build_conversation_system_jobs
from app.domains.agent_runs.tooling import (
    PermissionGate,
    SubagentDefinition,
    SubagentExecutor,
    ToolDefinition,
    ToolExecutionContext,
    ToolHandler,
    ToolRegistry,
    ToolResult,
)
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import (
    AssistantMessageCreate,
    AssistantReviseRequest,
    AssistantSessionCreate,
    AssistantToolCallCreate,
    AssistantToolCallUpdate,
)
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.ide.orchestrator import AgentOrchestrationError, orchestrate_agent_message
from app.domains.ide.review_skills import review_context_summary
from app.domains.ide.service import (
    IdeCommandExecutionError,
    IdeCommandNotFoundError,
    execute_ide_command_by_id,
)


class EventSink(Protocol):
    def record_plan(self, run: AgentRun, result: dict[str, Any]) -> None: ...

    def record_tool_trace(self, run: AgentRun, trace: AgentToolTrace, index: int) -> None: ...

    def record_artifact(self, run: AgentRun, *, kind: str, payload: dict[str, Any], requires_confirmation: bool) -> None: ...

    def record_permission_required(self, run: AgentRun, result: dict[str, Any], *, reason: str) -> None: ...

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


class AgentRuntime:
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
            elif intent in {"file.review", "file.revise"}:
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
            else:
                result = self._execute_tool(
                    "legacy.orchestrator",
                    ToolExecutionContext(
                        session=session,
                        run=run,
                        agent_session_id=agent_session_id,
                        assistant_session_id=assistant_session.id,
                        user_message=user_message,
                        args=args,
                    ),
                    {"message": {**message, "run_id": run.public_id}},
                ).output["result"]
                result["runtime_mode"] = "legacy_adapter"
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
            self._run_hidden_system_jobs(session, run=run, assistant_session_id=assistant_session.id, result=result)
            result.pop("_events_recorded", None)
            return result
        self._event_sink.record_plan(run, result)
        for index, trace in enumerate(_trace_objects(result)):
            self._event_sink.record_tool_trace(run, trace, index)
        self._record_result_artifacts(run, result)
        self._run_hidden_system_jobs(session, run=run, assistant_session_id=assistant_session.id, result=result)
        if _result_requires_confirmation(result):
            self._event_sink.record_permission_required(run, result, reason="requires_user_confirmation")
            result.setdefault("agent_result", {})["writeback_blocked_until_user_confirms"] = True
            return result
        self._event_sink.complete(run, result)
        return result

    def _run_hidden_system_jobs(
        self,
        session: Session,
        *,
        run: AgentRun,
        assistant_session_id: int,
        result: dict[str, Any],
    ) -> None:
        assistant_session = assistant_service.get_assistant_session(session, assistant_session_id)
        jobs = build_conversation_system_jobs(
            assistant_session_id=assistant_session.id,
            current_title=assistant_session.title,
            messages=assistant_session.messages,
            result=result,
        )
        if not jobs:
            return
        result_jobs: dict[str, Any] = {}
        for job in jobs:
            result_jobs[job.key] = job.result_payload
            if job.key == "title" and job.result_payload.get("updated_session_title") is True:
                title = job.result_payload.get("title")
                if isinstance(title, str) and title.strip():
                    assistant_session.title = title[:160]
                    session.add(assistant_session)
                    session.commit()
                    session.refresh(assistant_session)
            self._event_sink.record_system_job(
                run,
                key=job.key,
                payload=job.event_payload,
                artifact_kind=job.artifact_kind,
                artifact_payload=job.artifact_payload,
            )
        result["system_jobs"] = result_jobs

    def _run_chat_explain(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        context = _compact_text(args.get("context") or args.get("selection") or args.get("content"), limit=900)
        answer = "我可以解释当前上下文、评审结果或命令执行计划。" if not context else f"这段上下文的核心是：{context}"
        assistant_service.append_assistant_message(
            session,
            assistant_session_id,
            AssistantMessageCreate(role="user", content=user_message),
        )
        assistant_service.append_assistant_message(
            session,
            assistant_session_id,
            AssistantMessageCreate(role="assistant", content=answer),
        )
        return _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="chat.explain",
            user_message=user_message,
            plan=[_plan_step("respond", "解释用户问题，不执行写命令。", "completed")],
            agent_result={"summary": answer, "requires_user_confirmation": False},
            tool_trace=[],
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
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
            args,
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
            )

        revise = self._execute_tool(
            "file.revise",
            ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args),
            {**args, "review_report": args.get("review_report") if isinstance(args.get("review_report"), dict) else review_report},
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

    def _execute_tool(self, tool_name: str, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        tool = self._tool_registry.get(tool_name)
        decision = self._permission_gate.decide(context.run, tool)
        if decision.status == "require_approval" and tool_name not in {"file.revise", "bookrun.start", "legacy.orchestrator"}:
            raise AgentOrchestrationError(f"工具 {tool_name} 需要先获得权限确认：{decision.reason}")
        return tool.handler(context, payload)

    def _record_result_artifacts(self, run: AgentRun, result: dict[str, Any]) -> None:
        agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
        review_report = agent_result.get("review_report")
        if isinstance(review_report, dict):
            self._event_sink.record_artifact(run, kind="review_report", payload=review_report, requires_confirmation=False)
        proposed_patch = result.get("proposed_patch")
        if isinstance(proposed_patch, dict):
            self._event_sink.record_artifact(
                run,
                kind="proposed_patch",
                payload=proposed_patch,
                requires_confirmation=bool(proposed_patch.get("requires_confirmation", True)),
            )
        book_run = agent_result.get("book_run")
        if isinstance(book_run, dict) and isinstance(book_run.get("checkpoint"), list) and book_run["checkpoint"]:
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
        self._tool_registry.register(
            ToolDefinition("context.load", "读取当前文件与上下文摘要。", {}, {}, "auto", "read", False, self._context_load)
        )
        self._tool_registry.register(
            ToolDefinition("file.review", "执行 chapter_polish 多子代理审稿。", {}, {}, "auto", "analyze", False, self._file_review)
        )
        self._tool_registry.register(
            ToolDefinition("file.revise", "生成待确认文件修订补丁。", {}, {}, "confirm", "write_pending", True, self._file_revise)
        )
        self._tool_registry.register(
            ToolDefinition("judge.run", "对生成内容执行轻量检查。", {}, {}, "auto", "analyze", False, self._judge_run)
        )
        self._tool_registry.register(
            ToolDefinition("judge.repair", "通过 IDE command registry 生成 Judge 修复。", {}, {}, "confirm", "write_pending", True, self._ide_command_tool("judge.repair"))
        )
        self._tool_registry.register(
            ToolDefinition("bookrun.start", "启动 managed 写作任务。", {}, {}, "confirm", "long_running", True, self._ide_command_tool("bookrun.start"))
        )
        for name in ("bookrun.pause", "bookrun.resume", "bookrun.retry_from_checkpoint"):
            self._tool_registry.register(
                ToolDefinition(name, f"执行 {name} 控制命令。", {}, {}, "auto", "long_running", False, self._ide_command_tool(name))
            )
        self._tool_registry.register(
            ToolDefinition("legacy.orchestrator", "兼容旧 IDE orchestrator 分支。", {}, {}, "auto", "analyze", False, self._legacy_orchestrator)
        )

    def _context_load(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = _required_string(payload, "content")
        context_bundle = payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else None
        summary = review_context_summary(context_bundle)
        output = {
            "file_path": file_path,
            "content": content,
            "context_bundle": context_bundle,
            "context_summary": summary,
        }
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="context.load",
                status="completed",
                input_summary={"file_path": file_path, "content_chars": len(content)},
                output_summary={"context_file_count": summary["file_count"], "context_kinds": summary["kinds"]},
            ),
        )

    def _file_review(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = _required_string(payload, "content")
        context_bundle = payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else None
        report, traces = _build_multi_agent_review_report_with_executor(
            self._subagents,
            file_path=file_path,
            content=content,
            context_bundle=context_bundle,
            user_message=_context.user_message,
            requested_role_hints=_role_hints(_context.args),
            requested_role_mentions=_role_mentions(_context.args),
        )
        summary = _review_report_summary(report)
        return ToolResult(
            status="completed",
            output={"review_report": report, "summary": summary, "traces": traces},
            trace=AgentToolTrace(
                tool_name="file.review",
                status="completed",
                input_summary={"file_path": file_path, "content_chars": len(content)},
                output_summary={"issue_count": len(report["issues"]), "mode": report["mode"]},
            ),
        )

    def _file_revise(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = _required_string(payload, "content")
        instruction = _optional_string(payload.get("instruction")) or context.user_message
        review_report = payload.get("review_report") if isinstance(payload.get("review_report"), dict) else None
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
                    context_bundle=payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else None,
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
            trace=AgentToolTrace(
                tool_name="file.revise",
                status="completed",
                input_summary={
                    "file_path": file_path,
                    "content_chars": len(content),
                    "review_issue_count": len(_scope_issues(scope)),
                    "applied_scope": public_scope,
                },
                output_summary=revise_output_summary,
            ),
        )

    def _judge_run(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        content = str(payload.get("content") or "")
        issue_count = 0
        if any(marker in content for marker in ("这说明", "其实", "显然")):
            issue_count += 1
        output = {"issue_count": issue_count, "mode": payload.get("mode") or "runtime_smoke"}
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="judge.run",
                status="completed",
                input_summary={"content_chars": len(content), "mode": output["mode"]},
                output_summary=output,
            ),
        )

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

    def _legacy_orchestrator(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        try:
            result = orchestrate_agent_message(
                context.session,
                agent_session_id=context.agent_session_id,
                message=payload.get("message") if isinstance(payload.get("message"), dict) else {},
            )
        except AgentOrchestrationError:
            raise
        return ToolResult(
            status="completed",
            output={"result": result},
            trace=AgentToolTrace(
                tool_name="legacy.orchestrator",
                status="completed",
                input_summary={"intent": result.get("intent")},
                output_summary={"plan_steps": len(result.get("plan") if isinstance(result.get("plan"), list) else [])},
            ),
        )


def _resolve_assistant_session(
    session: Session,
    *,
    user_message: str,
    message: dict[str, Any],
    args: dict[str, Any],
):
    requested_id = _optional_positive_int(message.get("assistant_session_id")) or _optional_positive_int(args.get("assistant_session_id"))
    if requested_id is not None:
        try:
            return assistant_service.get_assistant_session(session, requested_id)
        except assistant_service.AssistantSessionNotFoundError as exc:
            raise AgentOrchestrationError(str(exc)) from exc
    return assistant_service.create_assistant_session(
        session,
        AssistantSessionCreate(title=f"IDE Agent: {user_message[:120]}", task_type="ide_agent_orchestration", messages=[]),
    )


def _base_response(
    *,
    agent_session_id: str,
    assistant_session_id: int,
    intent: str,
    user_message: str,
    plan: list[dict[str, Any]],
    agent_result: dict[str, Any],
    tool_trace: list[AgentToolTrace],
    proposed_patch: dict[str, Any] | None = None,
    runtime_mode: str = "agent_runtime",
    role_hints: list[str] | None = None,
    role_mentions: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "agent_result",
        "session_id": agent_session_id,
        "assistant_session_id": assistant_session_id,
        "intent": intent,
        "user_message": user_message,
        "agent_role_hints": role_hints or [],
        "agent_role_mentions": role_mentions or [],
        "plan": plan,
        "agent_result": agent_result,
        "tool_trace": [item.as_dict() for item in tool_trace],
        "proposed_patch": proposed_patch,
        "runtime_mode": runtime_mode,
    }


def _trace_objects(result: dict[str, Any]) -> list[AgentToolTrace]:
    traces = result.get("tool_trace") if isinstance(result.get("tool_trace"), list) else []
    objects: list[AgentToolTrace] = []
    for trace in traces:
        if isinstance(trace, AgentToolTrace):
            objects.append(trace)
        elif isinstance(trace, dict):
            objects.append(
                AgentToolTrace(
                    tool_name=str(trace.get("tool_name") or "unknown"),
                    status=str(trace.get("status") or "completed"),
                    input_summary=trace.get("input_summary") if isinstance(trace.get("input_summary"), dict) else {},
                    output_summary=trace.get("output_summary") if isinstance(trace.get("output_summary"), dict) else None,
                    audit_event_id=trace.get("audit_event_id") if isinstance(trace.get("audit_event_id"), str) else None,
                    assistant_tool_call_id=trace.get("assistant_tool_call_id") if isinstance(trace.get("assistant_tool_call_id"), int) else None,
                    error_message=trace.get("error_message") if isinstance(trace.get("error_message"), str) else None,
                )
            )
    return objects


def _result_requires_confirmation(result: dict[str, Any]) -> bool:
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    proposed_patch = result.get("proposed_patch") if isinstance(result.get("proposed_patch"), dict) else None
    return bool(
        agent_result.get("requires_user_confirmation")
        or agent_result.get("confirmation_required")
        or (proposed_patch and proposed_patch.get("requires_confirmation"))
    )


def _plan_step(step: str, detail: str, status: str) -> dict[str, str]:
    return {"step": step, "detail": detail, "status": status}


def _required_string(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if isinstance(value, str) and value.strip():
        return value
    raise AgentOrchestrationError(f"Agent intent 缺少参数：{key}。")


def _required_int(args: dict[str, Any], key: str) -> int:
    value = args.get(key)
    if isinstance(value, int) and value > 0:
        return value
    raise AgentOrchestrationError(f"Agent intent 缺少参数：{key}。")


def _optional_positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    return None


def _safe_summary(payload: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for key, value in payload.items():
        if key == "content" and isinstance(value, str):
            summary["content_chars"] = len(value)
        elif isinstance(value, str):
            summary[key] = _compact_text(value, limit=240)
        elif isinstance(value, int | float | bool) or value is None:
            summary[key] = value
        elif isinstance(value, list):
            summary[key] = {"count": len(value)}
        elif isinstance(value, dict):
            summary[key] = {"keys": sorted(str(item) for item in value)[:20]}
    return summary


def _judge_run_args_from_scene_packet(session: Session, scene_packet_id: int) -> dict[str, Any]:
    row = session.execute(
        select(ScenePacket, Scene, Chapter)
        .join(Scene, ScenePacket.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(ScenePacket.id == scene_packet_id)
        .limit(1)
    ).first()
    if row is None:
        raise AgentOrchestrationError("Scene Packet 不存在，无法执行章节审阅。")
    scene_packet, scene, _chapter = row
    content = (scene.content or "").strip()
    if not content:
        raise AgentOrchestrationError("场景正文为空，无法执行章节审阅。")
    packet = scene_packet.packet or {}
    return {
        "scene_id": scene.id,
        "scene_packet_id": scene_packet.id,
        "content": content,
        "required_facts": _string_list(packet.get("必须包含事实")),
        "style_rules": _style_rules(packet.get("风格规则")),
        "evidence_links": _dict_list(packet.get("证据链接")),
    }


def _string_list(value: object) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _dict_list(value: object) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _style_rules(value: object) -> list[str]:
    return _string_list(value)
