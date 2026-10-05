from __future__ import annotations

from dataclasses import replace
from typing import Any

from sqlalchemy.orm import Session

from app.common.llm_control import check_run_interruption
from app.domains.agent_runs import fs_tools, loop_runtime
from app.domains.agent_runs._text import compact_text as _compact_text
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.compaction import CompactionRejected, validate_compaction_publication
from app.domains.agent_runs.compaction_job import prepare_conversation_compaction
from app.domains.agent_runs.events.review_sources import current_conversation_review
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
from app.domains.agent_runs.result_contracts import AgentExecutionOutcome
from app.domains.agent_runs.revise_scope import revision_references_review
from app.domains.agent_runs.runtime_recovery import build_runtime_interruption_payload
from app.domains.agent_runs.system_jobs import build_conversation_system_jobs
from app.domains.agent_runs.tools import ToolExecutionContext, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import (
    chat_context_block as _chat_context_block,
)
from app.domains.agent_runs.tools.runtime_arguments import (
    sanitize_loop_tool_arguments,
)
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantMessageCreate, AssistantToolCallCreate


class ConversationRuntimeMixin:
    def _runtime_interruption(self, run: AgentRun, *, boundary: str) -> dict[str, Any] | None:
        checker = getattr(self._event_sink, "runtime_interruption", None)
        interruption = checker(run, boundary=boundary) if callable(checker) else build_runtime_interruption_payload(run, boundary=boundary)
        execution = self._external_execution
        if execution is not None and execution.stored is not None and interruption is not None and run.status == "paused":
            from app.domains.agent_runs.loop.external_wait_store import read_external_wait

            current = read_external_wait(self._external_session, run)
            if current.wait.execution_epoch == execution.lease.execution_epoch:
                return None  # Receipt wait, not author pause. No worker is restarted here.
        return interruption

    def _run_hidden_system_jobs(
        self,
        session: Session,
        *,
        run: AgentRun,
        assistant_session_id: int,
        result: dict[str, Any],
    ) -> None:
        assistant_session = assistant_service.get_assistant_session(session, assistant_session_id)
        compaction_payload = prepare_conversation_compaction(session, assistant_session_id)
        jobs = build_conversation_system_jobs(
            assistant_session_id=assistant_session.id,
            current_title=assistant_session.title,
            messages=assistant_session.messages,
            result=result,
            compaction_payload=compaction_payload,
        )
        if not jobs:
            return
        result_jobs: dict[str, Any] = {}
        for job in jobs:
            check_run_interruption(f"before_publish:system_job:{job.key}")
            if job.key == "compaction" and job.artifact_payload is not None:
                try:
                    validate_compaction_publication(session, job.artifact_payload)
                except CompactionRejected:
                    failed = {**job.result_payload, "status": "failed", "code": "source_drift"}
                    failed.pop("summary", None)
                    job = replace(job, result_payload=failed, artifact_kind=None, artifact_payload=None,
                                  event_payload={**failed, "message": "发布前来源改变，压缩未发布。"})
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
        check_run_interruption("before_fallback")
        context_block = _chat_context_block(args)
        failure = None
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
            failure = AgentExecutionOutcome(status="failed", code="provider_error", message=answer)
        # Complete response usage has already been recorded by chat_reply.
        # Do not commit late text or a user turn if cancellation won this boundary.
        check_run_interruption("before_finalize:assistant.chat")
        assistant_service.append_assistant_message(
            session, assistant_session_id, AssistantMessageCreate(role="user", content=user_message),
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
            plan=[_plan_step("respond", "就项目上下文作答，不执行写命令。", "failed" if failure else "completed")],
            agent_result={
                "summary": answer, "requires_user_confirmation": False,
                **({"execution_outcome": failure.model_dump()} if failure else {}),
            },
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
            if self._external_execution is not None:
                raise ValueError("external_writeback_requires_project")
            return None
        if assistant_service.missing_book_generation_env():
            if self._external_execution is not None:
                raise ValueError("external_writeback_requires_configured_provider")
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
        plan_recorded = run.current_step == "resumed" or (self._external_execution is not None and self._external_execution.resumed)
        trace_index = sum(event.event_type == "tool_trace" for event in run.events) if plan_recorded else 0

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
        offered = args.get("review_report") if isinstance(args.get("review_report"), dict) else None
        required_review = revision_references_review(user_message)
        latest_review_report = current_conversation_review(
            session, assistant_session_id, offered=offered, required=required_review and offered is not None,
        ) if offered is not None or required_review else None
        context.current_review_report = latest_review_report
        # C01：循环内 fs.read 读到的独特事实。writer 工具的 snapshot 只吃前端 bundle，
        # 模型本轮读到的事实若不显式交接，送达就没有保证（外层模型可能复述也可能不复述）。
        loop_read_facts: dict[str, dict[str, Any]] = {}

        def execute_fs_tool(registry_name: str, arguments: dict[str, Any]) -> ToolResult:
            nonlocal latest_review_report
            # 路径、正文与内层上下文都由后端生成；模型只能提交 ToolSpec 声明的业务参数。
            payload = sanitize_loop_tool_arguments(arguments)
            definition = self._tool_registry.get(registry_name)
            if definition.loop_input_mode == "existing_file":
                rel_path = _optional_string(payload.pop("path", None))
                if not rel_path:
                    raise fs_tools.FsToolError("缺少 path：请提供项目内的相对文件路径。")
                if self._external_execution is not None and registry_name == "file.revise":
                    file_path, content, raw = fs_tools.read_project_file_raw(project_path, rel_path)
                    self._external_execution.raw_inputs[rel_path] = raw
                    payload.update(file_path=file_path, content=content, _trace_file_path=rel_path)
                else:
                    read = fs_tools.fs_read(project_path, rel_path, offset=0, limit=200_000)
                    if read.get("truncated") is True:
                        raise fs_tools.FsToolError("文件超过单次处理上限，请缩小范围（分章 / 拆文件）后再审稿或修订。")
                    payload["file_path"] = fs_tools.resolve_project_file(project_path, rel_path)
                    payload["content"] = read["content"]
                    payload["_trace_file_path"] = read["path"]
            elif definition.loop_input_mode == "new_file":
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
            if definition.loop_trusted_context:
                bundle = context.args.get("context_bundle")
                snapshot = build_llm_context_snapshot(
                    run_state=context.run,
                    intent=registry_name,
                    user_message=context.user_message,
                    file_path=str(payload["_trace_file_path"]),
                    content=str(payload.get("content") or ""),
                    context_bundle={**(bundle if isinstance(bundle, dict) else {}), "project_root": project_path},
                    role_hints=_role_hints(context.args),
                    role_mentions=_role_mentions(context.args),
                    review_report=latest_review_report,
                    event_history=context.run.events,
                    artifacts=context.run.artifacts,
                    extra_context_files=tuple(loop_read_facts.values()),
                )
                if registry_name == "file.revise":
                    payload["review_report"] = latest_review_report or snapshot.get("review_report")
                payload["llm_context_snapshot"] = snapshot
                payload["llm_prompt_context_bundle"] = (
                    llm_context_snapshot_to_prompt_context_bundle(snapshot)
                )
            result = self._execute_tool(
                registry_name, replace(context, writing_read_sources=tuple(loop_read_facts.values())), payload,
            )
            # Loop artifacts are persisted only at settlement. Hand off this
            # round's successful structured review before a later writer runs.
            if result.status == "completed":
                for artifact in result.artifacts:
                    if artifact.kind == "review_report":
                        latest_review_report = artifact.payload
                        context.current_review_report = latest_review_report
                # C01：登记成功的 fs.read，作为后续 writer snapshot 的附加事实来源。
                if registry_name == "fs.read" and isinstance(result.output, dict):
                    read_path = result.output.get("path")
                    read_content = result.output.get("content")
                    if isinstance(read_path, str) and read_path and isinstance(read_content, str) and read_content:
                        loop_read_facts[read_path] = {
                            "relative_path": read_path,
                            "excerpt": read_content,
                        }
            return result

        if self._external_execution is not None:
            ensure_plan_recorded()  # Never record a late plan over the durable wait token.
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
                on_text=self._on_text,
                should_interrupt=lambda boundary: self._runtime_interruption(run, boundary=boundary),
                author_view=AuthorView.from_payload(args),
                pinned_context=_chat_context_block(args),
                external_execution=self._external_execution,
                recovery_message={"intent": "chat.explain", "user_message": user_message,
                                  "assistant_session_id": assistant_session_id, "args": args},
            )
        except loop_runtime.ChatLoopUnavailableError:
            if self._external_execution is not None:
                raise ValueError("external_writeback_provider_unavailable") from None
            return None

        if outcome.external_wait is not None:
            from app.domains.agent_runs.loop.external_chat import waiting_frame

            notifier = getattr(self._event_sink, "notify_external_wait", None)
            if callable(notifier):
                notifier(run)
            return waiting_frame(session, run, outcome.external_wait)
        ensure_plan_recorded()
        interruption = outcome.interruption if outcome.interrupted else None
        latest_interruption = self._runtime_interruption(run, boundary="before_finalize:assistant.chat_loop")
        # SDK 已检查模型/工具边界；计划落库与最终结算期间仍可能收到新的控制消息。
        # 已中断时保留原边界，但 paused 后又收到 stopped 必须以新的控制状态为准。
        if latest_interruption is not None and (
            interruption is None or latest_interruption["status"] != interruption["status"]
        ):
            interruption = latest_interruption
        evidence_payload = AssistantToolCallCreate(
            tool_name="assistant.chat_loop",
            status=("paused" if interruption["status"] == "paused" else "failed") if interruption else (
                "failed" if outcome.execution_outcome is not None else "completed"
            ),
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
                **({"execution_outcome": outcome.execution_outcome.model_dump()} if outcome.execution_outcome else {}),
                "proposed_patch_id": (outcome.proposed_patch or {}).get("id"),
                **({"runtime_interruption": interruption} if interruption is not None else {}),
            },
        )
        if interruption is not None:
            # 停止投递不等于调用未发生：保留累计用量与既有工具审计，不保存迟到回答。
            if outcome.rounds > 0:
                assistant_service.create_assistant_tool_call(session, assistant_session_id, evidence_payload)
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
                interrupted_result, interruption, events_recorded=True
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
            evidence_payload,
        )
        plan = [
            _plan_step(
                "agent.loop",
                outcome.answer if outcome.execution_outcome else f"工具循环完成：{outcome.rounds} 轮、{outcome.tool_call_count} 次工具调用。",
                "failed" if outcome.execution_outcome else "completed",
            )
        ]
        # 自动档下补丁自己带着「不必等点击」，run 就不该再挂在 permission.confirm 上。
        awaits_confirmation = outcome.patch_proposal is not None and outcome.patch_proposal.requires_confirmation
        agent_result: dict[str, Any] = {
            "summary": answer,
            "requires_user_confirmation": awaits_confirmation,
            **({"execution_outcome": outcome.execution_outcome.model_dump()} if outcome.execution_outcome else {}),
        }
        if outcome.review_report is not None:
            agent_result["review_report"] = outcome.review_report
        if awaits_confirmation:
            plan.append(_plan_step("permission.confirm", "文件写回前等待作者确认。", "needs_approval"))
        elif outcome.proposed_patch is not None:
            plan.append(_plan_step("writeback.auto", "补丁已准备，实际写回与快照由 Desktop 执行；这不是落盘回执。", "completed"))
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
