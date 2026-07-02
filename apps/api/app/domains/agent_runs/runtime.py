from __future__ import annotations

import uuid
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs import fs_tools, loop_runtime
from app.domains.agent_runs._text import _compact_text, _optional_string
from app.domains.agent_runs.bookrun_summary import (
    _bookrun_budget_details,
    _bookrun_budget_summary,
    _bookrun_chapter_plan_summary,
    _bookrun_risk_summary,
)
from app.domains.agent_runs.consistency_scan import consistency_scan
from app.domains.agent_runs.errors import AgentOrchestrationError
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
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    llm_context_snapshot_to_prompt_context_bundle,
    llm_context_snapshot_trace_summary,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun
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
from app.domains.agent_runs.runtime_recovery import (
    RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    build_runtime_interruption_payload,
    build_runtime_pending_call_resolution_payload,
    build_runtime_pending_call_summary,
)
from app.domains.agent_runs.system_jobs import build_conversation_system_jobs
from app.domains.agent_runs.tooling import (
    PermissionGate,
    SubagentDefinition,
    SubagentExecutor,
    ToolArtifact,
    ToolExecutionContext,
    ToolHandler,
    ToolRegistry,
    ToolResult,
    list_agent_runtime_tool_specs,
    tool_definition_from_spec,
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
from app.domains.ide.orchestrator import (
    orchestrate_agent_message,  # noqa: F401 保留 monkeypatch 契约（test_agent_runs.py:390）
)
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

    def _runtime_interruption(self, run: AgentRun, *, boundary: str) -> dict[str, Any] | None:
        checker = getattr(self._event_sink, "runtime_interruption", None)
        if callable(checker):
            return checker(run, boundary=boundary)
        return build_runtime_interruption_payload(run, boundary=boundary)

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
        loop_result = self._try_chat_loop(
            session,
            run=run,
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            user_message=user_message,
            args=args,
        )
        if loop_result is not None:
            return loop_result
        assistant_service.append_assistant_message(
            session,
            assistant_session_id,
            AssistantMessageCreate(role="user", content=user_message),
        )
        context_block = _chat_context_block(args)
        try:
            chat = assistant_service.chat_reply(
                session,
                user_message=user_message,
                context_block=context_block,
                assistant_session_id=assistant_session_id,
            )
            answer = chat["reply"] or "（模型这轮没返回内容，换个说法再问我一次？）"
        except assistant_service.AssistantLlmNotConfiguredError:
            answer = (
                "还没配置模型服务，所以我现在只能收到你的话、还答不了。"
                "去设置里填好 LLM 服务商和 key，再来问我就行。"
            )
        except assistant_service.AssistantReviseError as exc:
            answer = f"这轮没答上来：{_compact_text(str(exc), limit=300)}"
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
            plan=[_plan_step("respond", "就项目上下文作答，不执行写命令。", "completed")],
            agent_result={"summary": answer, "requires_user_confirmation": False},
            tool_trace=[],
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )

    def _try_chat_loop(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
    ) -> dict[str, Any] | None:
        """自由文本对话优先走 LLM 工具循环；不可用时返回 None 回落单轮回话。

        只在「有 project_path 且 LLM 已配置」时尝试；首轮模型调用失败
        （如 provider 不支持 tools、环境不完整）不发任何事件，静默回落。"""

        project_path = _optional_string(args.get("project_path"))
        if not project_path:
            return None
        if assistant_service.missing_book_generation_env():
            return None

        started = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="chat.explain",
            user_message=user_message,
            plan=[_plan_step("agent.loop", "读取项目文件、检索并整理回答。", "running")],
            agent_result={"summary": "正在查看项目文件。", "requires_user_confirmation": False},
            tool_trace=[],
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )
        plan_recorded = False
        trace_index = 0

        def ensure_plan_recorded() -> None:
            nonlocal plan_recorded
            if not plan_recorded:
                self._event_sink.record_plan(run, started)
                plan_recorded = True

        def on_trace(trace: AgentToolTrace) -> None:
            nonlocal trace_index
            ensure_plan_recorded()
            self._event_sink.record_tool_trace(run, trace, trace_index)
            trace_index += 1

        context = ToolExecutionContext(session, run, agent_session_id, assistant_session_id, user_message, args)

        def execute_fs_tool(registry_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
            # project_root / content / file_path 只由后端生成，LLM 传入的一律丢弃，防止越界或注入伪造正文。
            payload = {
                key: value
                for key, value in arguments.items()
                if key not in ("project_root", "content", "file_path")
            }
            if registry_name in ("file.review", "file.revise"):
                rel_path = _optional_string(payload.pop("path", None)) or _optional_string(arguments.get("file_path"))
                if not rel_path:
                    raise fs_tools.FsToolError("缺少 path：请提供项目内的相对文件路径。")
                read = fs_tools.fs_read(project_path, rel_path, offset=0, limit=200_000)
                if read.get("truncated") is True:
                    raise fs_tools.FsToolError("文件超过单次处理上限，请缩小范围（分章 / 拆文件）后再审稿或修订。")
                payload["file_path"] = fs_tools.resolve_project_file(project_path, rel_path)
                payload["content"] = read["content"]
            else:
                payload["project_root"] = project_path
            return self._execute_tool(registry_name, context, payload).output

        try:
            outcome = loop_runtime.run_chat_loop(
                session,
                llm_env=assistant_service.resolved_llm_env(),
                assistant_session_id=assistant_session_id,
                user_message=user_message,
                project_path=project_path,
                current_file=_optional_string(args.get("file_path")),
                execute_fs_tool=execute_fs_tool,
                on_trace=on_trace,
            )
        except loop_runtime.ChatLoopUnavailableError:
            return None

        ensure_plan_recorded()
        answer = outcome.answer or "（模型这轮没返回内容，换个说法再问我一次？）"
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
        loop_evidence = assistant_service.create_assistant_tool_call(
            session,
            assistant_session_id,
            AssistantToolCallCreate(
                tool_name="assistant.chat_loop",
                status="completed",
                input_summary={"message": user_message[:500], "project_path": project_path},
                output_summary={
                    "rounds": outcome.rounds,
                    "tool_call_count": outcome.tool_call_count,
                    "completion_tokens": outcome.completion_tokens,
                    "exhausted": outcome.exhausted,
                    "proposed_patch_id": (outcome.proposed_patch or {}).get("id"),
                },
            ),
        )
        plan = [
            _plan_step(
                "agent.loop",
                f"工具循环完成：{outcome.rounds} 轮、{outcome.tool_call_count} 次工具调用。",
                "completed",
            )
        ]
        agent_result: dict[str, Any] = {
            "summary": answer,
            "requires_user_confirmation": outcome.proposed_patch is not None,
        }
        if outcome.review_report is not None:
            agent_result["review_report"] = outcome.review_report
        if outcome.proposed_patch is not None:
            plan.append(_plan_step("permission.confirm", "文件写回前等待作者确认。", "needs_approval"))
        result = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="chat.explain",
            user_message=user_message,
            plan=plan,
            agent_result=agent_result,
            tool_trace=list(outcome.traces),
            proposed_patch=outcome.proposed_patch,
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )
        result["agent_result"]["chat_loop"] = {
            "rounds": outcome.rounds,
            "tool_call_count": outcome.tool_call_count,
            "assistant_tool_call_id": loop_evidence.id,
        }
        result["_events_recorded"] = True
        return result

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

    def _run_chapter_review(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        pending_call = _latest_runtime_pending_call(session, run, intent="chapter.review")
        if _should_resume_runtime_pending_call(run, pending_call):
            return self._resume_chapter_review_from_pending_call(
                session,
                run=run,
                agent_session_id=agent_session_id,
                assistant_session_id=assistant_session_id,
                user_message=user_message,
                args=args,
                pending_call=pending_call,
            )

        scene_packet_id = _required_int(args, "scene_packet_id")
        review_args = _judge_run_args_from_scene_packet(session, scene_packet_id)
        context = ToolExecutionContext(
            session=session,
            run=run,
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            user_message=user_message,
            args=args,
        )

        started = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="chapter.review",
            user_message=user_message,
            plan=[
                _plan_step("load_scene_packet", "读取 Scene Packet 与场景正文。", "completed"),
                _plan_step("judge.run", "通过 Tool Registry 执行章节评审。", "running"),
                _plan_step("judge.repair", "为可修复问题生成 proposed patch。", "pending"),
                _plan_step("approval", "修复写回必须等待用户确认 judge.approve。", "pending"),
            ],
            agent_result={"summary": "正在执行章节评审。", "requires_user_confirmation": False},
            tool_trace=[],
            runtime_mode="agent_runtime",
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )
        self._event_sink.record_plan(run, started)
        interruption = self._runtime_interruption(run, boundary="after_plan")
        if interruption is not None:
            return _runtime_interrupted_response(started, interruption, events_recorded=True)

        judge_result = self._execute_tool("judge.run", context, review_args)
        self._event_sink.record_tool_trace(run, judge_result.trace, 0)
        result_block = judge_result.output.get("result", {})
        payload = result_block.get("payload") if isinstance(result_block.get("payload"), dict) else {}
        issues = _payload_list(payload.get("issues"))

        partial = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="chapter.review",
            user_message=user_message,
            plan=[
                _plan_step("load_scene_packet", "读取 Scene Packet 与场景正文。", "completed"),
                _plan_step("judge.run", "通过 Tool Registry 执行章节评审。", "completed"),
                _plan_step("judge.repair", "等待继续后再判断是否生成修复建议。", "pending"),
                _plan_step("approval", "修复写回必须等待用户确认 judge.approve。", "pending"),
            ],
            agent_result={
                "summary": f"章节评审已完成：发现 {len(issues)} 个问题，等待继续后处理修复建议。",
                "issue_count": len(issues),
                "repair_patch_count": 0,
                "requires_user_confirmation": False,
            },
            tool_trace=[judge_result.trace],
            runtime_mode="agent_runtime",
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )
        interruption = self._runtime_interruption(run, boundary="after_tool:judge.run")
        if interruption is not None:
            self._record_chapter_review_pending_call(
                run,
                partial=partial,
                scene_packet_id=scene_packet_id,
                judge_output=judge_result.output,
                interruption=interruption,
            )
            return _runtime_interrupted_response(partial, interruption, events_recorded=True)

        repair_results: list[Any] = []
        for issue in issues:
            issue_id = issue.get("id")
            if isinstance(issue_id, int) and _can_repair_issue(issue, review_args["content"]):
                repair_result = self._execute_tool(
                    "judge.repair",
                    context,
                    {"issue_id": issue_id, "content": review_args["content"]},
                )
                repair_results.append(repair_result)
                self._event_sink.record_tool_trace(run, repair_result.trace, len(repair_results))

        patch_payload = _first_patch_payload(repair_results)
        proposed_patch = _proposed_patch_from_repair_patch(patch_payload) if patch_payload else None
        summary = f"章节审阅完成：发现 {len(issues)} 个问题，生成 {len(repair_results)} 个修复建议。"

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

        tool_trace = [judge_result.trace] + [r.trace for r in repair_results]
        result = _base_response(
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            intent="chapter.review",
            user_message=user_message,
            plan=[
                _plan_step("load_scene_packet", "读取 Scene Packet 与场景正文。", "completed"),
                _plan_step("judge.run", "通过 Tool Registry 执行章节评审。", "completed"),
                _plan_step("judge.repair", "为可修复问题生成 proposed patch。", "completed"),
                _plan_step(
                    "approval",
                    "修复写回必须等待用户确认 judge.approve。",
                    "needs_approval" if proposed_patch else "completed",
                ),
            ],
            agent_result={
                "summary": summary,
                "issue_count": len(issues),
                "repair_patch_count": len(repair_results),
                "requires_user_confirmation": proposed_patch is not None,
            },
            tool_trace=tool_trace,
            proposed_patch=proposed_patch,
            tool_artifacts=[artifact for repair_result in repair_results for artifact in repair_result.artifacts],
            runtime_mode="agent_runtime",
        )
        result["_events_recorded"] = True
        return result

    def _resume_chapter_review_from_pending_call(
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
        judge_output = payload.get("judge_output") if isinstance(payload.get("judge_output"), dict) else {}
        judge_trace_payload = payload.get("judge_trace") if isinstance(payload.get("judge_trace"), dict) else {}
        judge_trace = _trace_objects({"tool_trace": [judge_trace_payload]})
        result_block = judge_output.get("result") if isinstance(judge_output.get("result"), dict) else {}
        judge_payload = result_block.get("payload") if isinstance(result_block.get("payload"), dict) else {}
        issues = _payload_list(judge_payload.get("issues"))
        summary = f"章节审阅已从 pending 边界恢复：发现 {len(issues)} 个问题；未自动执行修复建议。"

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
            intent="chapter.review",
            user_message=user_message,
            plan=[
                _plan_step("load_scene_packet", "读取 Scene Packet 与场景正文。", "completed"),
                _plan_step("judge.run", "从 pending boundary 读取已完成的章节评审。", "completed"),
                _plan_step("judge.repair", "恢复路径不自动执行修复建议。", "completed"),
                _plan_step("approval", "无需写回确认。", "completed"),
            ],
            agent_result={
                "summary": summary,
                "issue_count": len(issues),
                "repair_patch_count": 0,
                "requires_user_confirmation": False,
                "resumed_from_pending_call": True,
                "pending_call_artifact_id": pending_call.id,
                "resumed_from_boundary": payload.get("boundary"),
            },
            tool_trace=judge_trace,
            tool_artifacts=[_runtime_pending_call_resolution_artifact(pending_call)],
            runtime_mode="agent_runtime",
            role_hints=_role_hints(args),
            role_mentions=_role_mentions(args),
        )
        result["_events_recorded"] = True
        return result

    def _run_chapter_review_repair(
        self,
        session: Session,
        *,
        run: AgentRun,
        agent_session_id: str,
        assistant_session_id: int,
        user_message: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        repair_args = {"issue_id": _required_int(args, "issue_id"), "content": _required_string(args, "content")}
        context = ToolExecutionContext(
            session=session,
            run=run,
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session_id,
            user_message=user_message,
            args=args,
        )

        result = self._execute_tool("judge.repair", context, repair_args)
        result_block = result.output.get("result", {})
        payload = result_block.get("payload") if isinstance(result_block.get("payload"), dict) else {}
        patch_payload = payload.get("patch") if isinstance(payload.get("patch"), dict) else None
        proposed_patch = _proposed_patch_from_repair_patch(patch_payload) if patch_payload else None
        summary = "已生成章节修复建议，等待用户确认后才能执行 judge.approve 写回。"

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
            intent="chapter.repair",
            user_message=user_message,
            plan=[
                _plan_step("judge.repair", "通过 Tool Registry 生成定向修复。", "completed"),
                _plan_step("approval", "等待用户确认后再执行 judge.approve 写回。", "needs_approval"),
            ],
            agent_result={"summary": summary, "requires_user_confirmation": proposed_patch is not None},
            tool_trace=[result.trace],
            proposed_patch=proposed_patch,
            tool_artifacts=list(result.artifacts),
        )

    def _execute_tool(self, tool_name: str, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        tool = self._tool_registry.get(tool_name)
        decision = self._permission_gate.decide(context.run, tool)
        if decision.status == "require_approval" and tool_name not in {"file.revise", "bookrun.start", "judge.repair"}:
            raise AgentOrchestrationError(f"工具 {tool_name} 需要先获得权限确认：{decision.reason}")
        return tool.handler(context, payload)

    def _record_result_artifacts(self, run: AgentRun, result: dict[str, Any]) -> None:
        recorded_kinds: set[str] = set()
        for artifact in _tool_artifacts_from_result(result):
            if artifact.kind in recorded_kinds:
                continue
            self._event_sink.record_artifact(
                run,
                kind=artifact.kind,
                payload=artifact.payload,
                requires_confirmation=artifact.requires_confirmation,
            )
            recorded_kinds.add(artifact.kind)

        agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
        review_report = agent_result.get("review_report")
        if isinstance(review_report, dict) and "review_report" not in recorded_kinds:
            self._event_sink.record_artifact(run, kind="review_report", payload=review_report, requires_confirmation=False)
        proposed_patch = result.get("proposed_patch")
        if isinstance(proposed_patch, dict) and "proposed_patch" not in recorded_kinds:
            self._event_sink.record_artifact(
                run,
                kind="proposed_patch",
                payload=proposed_patch,
                requires_confirmation=bool(proposed_patch.get("requires_confirmation", True)),
            )
        book_run = agent_result.get("book_run")
        if (
            isinstance(book_run, dict)
            and isinstance(book_run.get("checkpoint"), list)
            and book_run["checkpoint"]
            and "bookrun_checkpoint" not in recorded_kinds
        ):
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
        handlers: dict[str, ToolHandler] = {
            "context.load": self._context_load,
            "fs.list": self._fs_list,
            "fs.read": self._fs_read,
            "fs.search": self._fs_search,
            "project.consistency": self._project_consistency,
            "file.review": self._file_review,
            "file.revise": self._file_revise,
            "judge.run": self._judge_run,
        }
        for command_id in (
            "judge.repair",
            "bookrun.start",
            "bookrun.pause",
            "bookrun.resume",
            "bookrun.retry_from_checkpoint",
        ):
            handlers[command_id] = self._ide_command_tool(command_id)
        for spec in list_agent_runtime_tool_specs():
            handler = handlers.get(spec.name)
            if handler is None:
                raise AgentOrchestrationError(f"Agent Runtime 工具缺少 handler：{spec.name}")
            self._tool_registry.register(tool_definition_from_spec(spec, handler))

    def _fs_list(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        subpath = _optional_string(payload.get("subpath"))
        output = fs_tools.fs_list(project_root, subpath)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="fs.list",
                status="completed",
                input_summary={"subpath": subpath},
                output_summary={"entry_count": len(output["entries"]), "truncated": output["truncated"]},
            ),
        )

    def _fs_read(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        path = _required_string(payload, "path")
        output = fs_tools.fs_read(
            project_root,
            path,
            offset=_fs_int_arg(payload, "offset", 0),
            limit=_fs_int_arg(payload, "limit", 20_000),
        )
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="fs.read",
                status="completed",
                input_summary={"path": path},
                output_summary={
                    "path": output["path"],
                    "returned_chars": output["returned_chars"],
                    "truncated": output["truncated"],
                },
            ),
        )

    def _fs_search(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        query = _required_string(payload, "query")
        glob = _optional_string(payload.get("glob")) or "*.md"
        output = fs_tools.fs_search(
            project_root,
            query,
            glob=glob,
            use_regex=payload.get("use_regex") is True,
        )
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="fs.search",
                status="completed",
                input_summary={"query": query[:200], "glob": glob},
                output_summary={"match_count": len(output["matches"]), "truncated": output["truncated"]},
            ),
        )

    def _project_consistency(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        terms_raw = payload.get("terms")
        terms = (
            [term for term in terms_raw if isinstance(term, str) and term.strip()]
            if isinstance(terms_raw, list)
            else []
        )
        subpath = _optional_string(payload.get("subpath"))
        glob = _optional_string(payload.get("glob")) or "*.md"
        output = consistency_scan(project_root, terms, subpath=subpath, glob=glob)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.consistency",
                status="completed",
                input_summary={"terms": terms[:10], "subpath": subpath, "glob": glob},
                output_summary={
                    "scanned_files": output["scanned_files"],
                    "term_count": len(output["term_occurrences"]),
                    "time_marker_count": len(output["time_markers"]),
                    "repeated_clause_count": len(output["repeated_clauses"]),
                },
            ),
        )

    def _context_load(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = _required_string(payload, "content")
        context_bundle = payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else None
        summary = review_context_summary(context_bundle)
        llm_context_snapshot = build_llm_context_snapshot(
            run_state=_context.run,
            intent=_optional_string(payload.get("_agent_intent"))
            or _detect_intent(_context.user_message, _context.args, _context.args.get("intent")),
            user_message=_context.user_message,
            file_path=file_path,
            content=content,
            context_bundle=context_bundle,
            role_hints=_role_hints(_context.args),
            role_mentions=_role_mentions(_context.args),
            event_history=_context.run.events,
            artifacts=_context.run.artifacts,
        )
        llm_context_summary = llm_context_snapshot_trace_summary(llm_context_snapshot)
        llm_prompt_context_bundle = llm_context_snapshot_to_prompt_context_bundle(llm_context_snapshot)
        output = {
            "file_path": file_path,
            "content": content,
            "context_bundle": context_bundle,
            "context_summary": summary,
            "llm_context_snapshot": llm_context_snapshot,
            "llm_prompt_context_bundle": llm_prompt_context_bundle,
        }
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="context.load",
                status="completed",
                input_summary={"file_path": file_path, "content_chars": len(content)},
                output_summary={
                    "context_file_count": summary["file_count"],
                    "context_kinds": summary["kinds"],
                    "llm_context": llm_context_summary,
                },
            ),
        )

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
            if command_id == "judge.repair":
                patch_payload = result.payload.get("patch") if isinstance(result.payload.get("patch"), dict) else None
                proposed_patch = _proposed_patch_from_repair_patch(patch_payload) if patch_payload else None
                if proposed_patch is not None:
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
    project_path = _optional_string(args.get("project_path")) or _optional_string(message.get("project_path"))
    return assistant_service.create_assistant_session(
        session,
        AssistantSessionCreate(
            title=f"IDE Agent: {user_message[:120]}",
            task_type="ide_agent_orchestration",
            project_path=project_path,
            messages=[],
        ),
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
    tool_artifacts: list[ToolArtifact] | None = None,
) -> dict[str, Any]:
    response: dict[str, Any] = {
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
    if tool_artifacts:
        response["_tool_artifacts"] = tool_artifacts
    return response


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


def _latest_runtime_pending_call(session: Session, run: AgentRun, *, intent: str | None = None) -> AgentArtifact | None:
    artifacts = list(
        session.scalars(
            select(AgentArtifact)
            .where(
                AgentArtifact.run_id == run.id,
                AgentArtifact.kind.in_(
                    {RUNTIME_PENDING_CALL_ARTIFACT_KIND, RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND}
                ),
            )
            .order_by(AgentArtifact.id.desc())
        )
    )
    for artifact in artifacts:
        if artifact.kind == RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND:
            return None
        summary = build_runtime_pending_call_summary(
            artifact.payload,
            artifact_id=artifact.id,
            artifact_kind=artifact.kind,
        )
        if summary is not None and (intent is None or summary.get("intent") == intent):
            return artifact
    return None


def _should_resume_file_review(run: AgentRun, pending_call: AgentArtifact | None) -> bool:
    return _should_resume_runtime_pending_call(run, pending_call)


def _should_resume_runtime_pending_call(run: AgentRun, pending_call: AgentArtifact | None) -> bool:
    return pending_call is not None and run.status == "running" and run.current_step == "resumed"


def _file_review_resume_message(result: dict[str, Any]) -> dict[str, Any]:
    context_trace = result["tool_trace"][0] if result.get("tool_trace") else {}
    input_summary = context_trace.get("input_summary") if isinstance(context_trace, dict) else {}
    file_path = input_summary.get("file_path") if isinstance(input_summary, dict) else None
    return {
        "type": "user_message",
        "run_id": result.get("run_id"),
        "user_message": result.get("user_message"),
        "intent": "file.review",
        "args": {
            "file_path": file_path if isinstance(file_path, str) else None,
            "agent_role_hints": result.get("agent_role_hints") if isinstance(result.get("agent_role_hints"), list) else [],
            "agent_role_mentions": result.get("agent_role_mentions")
            if isinstance(result.get("agent_role_mentions"), list)
            else [],
        },
    }


def _chapter_review_resume_message(result: dict[str, Any], *, scene_packet_id: int) -> dict[str, Any]:
    return {
        "type": "user_message",
        "run_id": result.get("run_id"),
        "user_message": result.get("user_message"),
        "intent": "chapter.review",
        "args": {
            "scene_packet_id": scene_packet_id,
            "agent_role_hints": result.get("agent_role_hints") if isinstance(result.get("agent_role_hints"), list) else [],
            "agent_role_mentions": result.get("agent_role_mentions")
            if isinstance(result.get("agent_role_mentions"), list)
            else [],
        },
    }


def _runtime_pending_call_resolution_artifact(pending_call: AgentArtifact) -> ToolArtifact:
    return ToolArtifact(
        kind=RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
        payload=build_runtime_pending_call_resolution_payload(
            pending_call.payload,
            artifact_id=pending_call.id,
            artifact_kind=pending_call.kind,
        ),
        requires_confirmation=False,
    )


def _json_safe_review_output(review_output: dict[str, Any]) -> dict[str, Any]:
    traces = review_output.get("traces") if isinstance(review_output.get("traces"), list) else []
    return {
        **review_output,
        "traces": [trace.as_dict() if isinstance(trace, AgentToolTrace) else trace for trace in traces],
    }


def _tool_artifacts_from_result(result: dict[str, Any]) -> list[ToolArtifact]:
    raw_artifacts = result.pop("_tool_artifacts", None)
    if not isinstance(raw_artifacts, list):
        return []
    artifacts: list[ToolArtifact] = []
    for item in raw_artifacts:
        if isinstance(item, ToolArtifact):
            artifacts.append(item)
        elif isinstance(item, dict):
            kind = item.get("kind")
            payload = item.get("payload")
            if isinstance(kind, str) and kind and isinstance(payload, dict):
                artifacts.append(
                    ToolArtifact(
                        kind=kind,
                        payload=payload,
                        requires_confirmation=bool(item.get("requires_confirmation")),
                    )
                )
    return artifacts


def _result_requires_confirmation(result: dict[str, Any]) -> bool:
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    proposed_patch = result.get("proposed_patch") if isinstance(result.get("proposed_patch"), dict) else None
    return bool(
        agent_result.get("requires_user_confirmation")
        or agent_result.get("confirmation_required")
        or (proposed_patch and proposed_patch.get("requires_confirmation"))
    )


def _runtime_interrupted_response(
    result: dict[str, Any],
    interruption: dict[str, Any],
    *,
    events_recorded: bool = False,
) -> dict[str, Any]:
    agent_result = result.setdefault("agent_result", {})
    if not isinstance(agent_result, dict):
        agent_result = {}
        result["agent_result"] = agent_result
    agent_result["summary"] = _runtime_interruption_summary(interruption)
    agent_result["requires_user_confirmation"] = False
    agent_result["runtime_interrupted"] = True
    result["runtime_interruption"] = interruption
    result["_runtime_interrupted"] = True
    if events_recorded:
        result["_events_recorded"] = True
    return result


def _runtime_interruption_summary(interruption: dict[str, Any]) -> str:
    status = interruption.get("status")
    boundary = interruption.get("boundary")
    if status == "paused":
        return f"AgentRun 已在 {boundary} 边界暂停，等待继续指令。"
    if status == "stopped":
        return f"AgentRun 已在 {boundary} 边界停止。"
    return f"AgentRun 已在 {boundary} 边界中断。"


def _pop_runtime_internal_markers(result: dict[str, Any]) -> None:
    result.pop("_events_recorded", None)
    result.pop("_runtime_interrupted", None)
    result.pop("_tool_artifacts", None)


def _plan_step(step: str, detail: str, status: str) -> dict[str, str]:
    return {"step": step, "detail": detail, "status": status}


def _fs_int_arg(payload: dict[str, Any], key: str, default: int) -> int:
    """LLM 工具参数容错：int 直接用，数字字符串转换，其余回退默认值。"""

    value = payload.get(key)
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value)
    return default


def _chat_context_block(args: dict[str, Any]) -> str:
    """从前端项目上下文 bundle 拼一段供对话用的摘录；无 bundle 时返回空串。"""
    bundle = args.get("context_bundle")
    if not isinstance(bundle, dict):
        return ""
    files = bundle.get("files")
    if not isinstance(files, list):
        return ""
    entries: list[str] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        excerpt = _compact_text(item.get("excerpt"), limit=1500)
        if not excerpt:
            continue
        rel = _optional_string(item.get("relative_path")) or _optional_string(item.get("path")) or "（未命名）"
        kind = _optional_string(item.get("kind"))
        header = f"### {rel}" + (f"（{kind}）" if kind else "")
        entries.append(f"{header}\n<<<\n{excerpt}\n>>>")
    return "\n\n".join(entries)


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


def _llm_context_input_summary(snapshot: object) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {}
    snapshot_id = snapshot.get("snapshot_id")
    if not isinstance(snapshot_id, str) or not snapshot_id:
        return {}
    return {"llm_context_snapshot_id": snapshot_id}


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
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _dict_list(value: object) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _style_rules(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    rules: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            rules.append(item.strip())
        elif isinstance(item, dict):
            rule = item.get("rule")
            if isinstance(rule, str) and rule.strip():
                rules.append(rule.strip())
    return rules


def _payload_list(value: object) -> list[dict[str, Any]]:
    """Extract dict items from a list, filtering non-dict entries."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _can_repair_issue(issue: dict[str, Any], content: object) -> bool:
    """Check if a judge issue is eligible for auto-repair."""
    if not isinstance(content, str):
        return False
    if issue.get("status") != "open":
        return False
    if issue.get("recommended_repair_mode") == "none":
        return False
    start = issue.get("span_start")
    end = issue.get("span_end")
    return isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(content)


def _first_patch_payload(results: list[Any]) -> dict[str, Any] | None:
    """Extract first patch from ToolResult list via output[result][payload][patch]."""
    for result in results:
        result_block = result.output.get("result", {}) if hasattr(result, "output") else {}
        payload = result_block.get("payload") if isinstance(result_block.get("payload"), dict) else {}
        patch = payload.get("patch")
        if isinstance(patch, dict):
            return patch
    return None


def _proposed_patch_from_repair_patch(patch: dict[str, Any] | None) -> dict[str, Any] | None:
    """Convert a raw repair patch into the proposed_patch contract."""
    if not patch:
        return None
    patch_id = patch.get("id")
    proposed: dict[str, Any] = {
        "kind": "repair_patch",
        "repair_patch": patch,
        "requires_confirmation": True,
        "approval_command": None,
    }
    if isinstance(patch_id, int):
        proposed["approval_command"] = {"command_id": "judge.approve", "args": {"repair_patch_id": patch_id}}
    return proposed
