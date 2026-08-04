from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs import fs_tools, loop_runtime
from app.domains.agent_runs._text import compact_text as _compact_text
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.events.runtime_support import base_response as _base_response
from app.domains.agent_runs.events.runtime_support import plan_step as _plan_step
from app.domains.agent_runs.events.runtime_support import runtime_interrupted_response as _runtime_interrupted_response
from app.domains.agent_runs.intent import role_hints as _role_hints
from app.domains.agent_runs.intent import role_mentions as _role_mentions
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    llm_context_snapshot_to_prompt_context_bundle,
)
from app.domains.agent_runs.loop.author_view import AuthorView
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.runtime_recovery import build_runtime_interruption_payload
from app.domains.agent_runs.system_jobs import build_conversation_system_jobs
from app.domains.agent_runs.tools import ToolExecutionContext, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import (
    TRUSTED_WRITING_CONTEXT_TOOL_NAMES,
    sanitize_loop_tool_arguments,
)
from app.domains.agent_runs.tools.runtime_arguments import (
    chat_context_block as _chat_context_block,
)
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantMessageCreate, AssistantToolCallCreate


class ConversationRuntimeMixin:
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

        def execute_fs_tool(registry_name: str, arguments: dict[str, Any]) -> ToolResult:
            # 路径、正文与内层上下文都由后端生成；模型只能提交 ToolSpec 声明的业务参数。
            payload = sanitize_loop_tool_arguments(arguments)
            if registry_name in ("file.review", "file.revise", "project.trim_prose", "prose.continue"):
                rel_path = _optional_string(payload.pop("path", None))
                if not rel_path:
                    raise fs_tools.FsToolError("缺少 path：请提供项目内的相对文件路径。")
                read = fs_tools.fs_read(project_path, rel_path, offset=0, limit=200_000)
                if read.get("truncated") is True:
                    raise fs_tools.FsToolError("文件超过单次处理上限，请缩小范围（分章 / 拆文件）后再审稿或修订。")
                payload["file_path"] = fs_tools.resolve_project_file(project_path, rel_path)
                payload["content"] = read["content"]
                payload["_trace_file_path"] = read["path"]
            elif registry_name == "file.create":
                rel_path = _optional_string(payload.pop("path", None))
                if not rel_path:
                    raise fs_tools.FsToolError("缺少 path：请提供项目内的相对文件路径。")
                payload["file_path"] = fs_tools.resolve_new_project_file(project_path, rel_path)
                payload["_trace_file_path"] = (
                    fs_tools.resolve_project_root(project_path)
                    .joinpath(rel_path)
                    .resolve()
                    .relative_to(fs_tools.resolve_project_root(project_path))
                    .as_posix()
                )
            else:
                payload["project_root"] = project_path
            # 作者自定义指令与 canon 约束都要项目根定位。产字工具走上面的分支设 file_path /
            # content，此前从不回填 project_root，导致 prose.continue 在循环内静默丢掉
            # canon 硬约束（Ctrl+Shift+K 直连路径反而有），作者指令也进不去。
            payload.setdefault("project_root", project_path)
            if registry_name in TRUSTED_WRITING_CONTEXT_TOOL_NAMES:
                snapshot = build_llm_context_snapshot(
                    run_state=context.run,
                    intent=registry_name,
                    user_message=context.user_message,
                    file_path=str(payload["_trace_file_path"]),
                    content=str(payload.get("content") or ""),
                    context_bundle=context.args.get("context_bundle"),
                    role_hints=_role_hints(context.args),
                    role_mentions=_role_mentions(context.args),
                    event_history=context.run.events,
                    artifacts=context.run.artifacts,
                )
                payload["llm_context_snapshot"] = snapshot
                payload["llm_prompt_context_bundle"] = (
                    llm_context_snapshot_to_prompt_context_bundle(snapshot)
                )
            return self._execute_tool(registry_name, context, payload)

        try:
            outcome = loop_runtime.run_chat_loop(
                session,
                run=run,
                permission_gate=self._permission_gate,
                tool_definitions=self._tool_registry.all(),
                llm_env=assistant_service.resolved_llm_env(),
                assistant_session_id=assistant_session_id,
                user_message=user_message,
                project_path=project_path,
                current_file=_optional_string(args.get("file_path")),
                execute_fs_tool=execute_fs_tool,
                on_trace=on_trace,
                should_interrupt=lambda boundary: self._runtime_interruption(run, boundary=boundary),
                author_view=AuthorView.from_payload(args),
                pinned_context=_chat_context_block(args),
            )
        except loop_runtime.ChatLoopUnavailableError:
            return None

        ensure_plan_recorded()
        if outcome.interrupted and outcome.interruption is not None:
            # 循环被 pause/stop 收尾：计划与已完成的 trace 已落库，不 append 消息、不 complete，
            # run.status 保持控制通道写入的 stopped/paused。顶层据 _runtime_interrupted 直接返回。
            interrupted_result = _base_response(
                agent_session_id=agent_session_id,
                assistant_session_id=assistant_session_id,
                intent="chat.explain",
                user_message=user_message,
                plan=[_plan_step("agent.loop", "循环已按作者操作停下。", "stopped")],
                agent_result={"summary": outcome.answer, "requires_user_confirmation": False},
                tool_trace=list(outcome.traces),
                role_hints=_role_hints(args),
                role_mentions=_role_mentions(args),
            )
            return _runtime_interrupted_response(
                interrupted_result, outcome.interruption, events_recorded=True
            )
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
                    "prompt_tokens": outcome.prompt_tokens,
                    "completion_tokens": outcome.completion_tokens,
                    "token_usage": outcome.token_usage,
                    "cost_cny_estimated": outcome.cost_cny_estimated,
                    "cost_breakdown": outcome.cost_breakdown,
                    "token_usage_source": outcome.token_usage_source,
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
        # 自动档下补丁自己带着「不必等点击」，run 就不该再挂在 permission.confirm 上。
        awaits_confirmation = outcome.patch_proposal is not None and outcome.patch_proposal.requires_confirmation
        agent_result: dict[str, Any] = {
            "summary": answer,
            "requires_user_confirmation": awaits_confirmation,
        }
        if outcome.review_report is not None:
            agent_result["review_report"] = outcome.review_report
        if awaits_confirmation:
            plan.append(_plan_step("permission.confirm", "文件写回前等待作者确认。", "needs_approval"))
        elif outcome.proposed_patch is not None:
            plan.append(_plan_step("writeback.auto", "按本项目的自动档直接写盘（写前存快照）。", "completed"))
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
            tool_artifacts=list(outcome.artifacts),
        )
        result["agent_result"]["chat_loop"] = {
            "rounds": outcome.rounds,
            "tool_call_count": outcome.tool_call_count,
            "assistant_tool_call_id": loop_evidence.id,
        }
        result["_events_recorded"] = True
        return result
