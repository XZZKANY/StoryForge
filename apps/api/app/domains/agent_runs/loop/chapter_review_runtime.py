from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs.events.runtime_support import base_response as _base_response
from app.domains.agent_runs.events.runtime_support import latest_runtime_pending_call as _latest_runtime_pending_call
from app.domains.agent_runs.events.runtime_support import plan_step as _plan_step
from app.domains.agent_runs.events.runtime_support import runtime_interrupted_response as _runtime_interrupted_response
from app.domains.agent_runs.events.runtime_support import (
    runtime_pending_call_resolution_artifact as _runtime_pending_call_resolution_artifact,
)
from app.domains.agent_runs.events.runtime_support import (
    should_resume_runtime_pending_call as _should_resume_runtime_pending_call,
)
from app.domains.agent_runs.events.runtime_support import trace_objects as _trace_objects
from app.domains.agent_runs.intent import role_hints as _role_hints
from app.domains.agent_runs.intent import role_mentions as _role_mentions
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.agent_runs.tools import ToolExecutionContext
from app.domains.agent_runs.tools.runtime_arguments import can_repair_issue as _can_repair_issue
from app.domains.agent_runs.tools.runtime_arguments import first_patch_payload as _first_patch_payload
from app.domains.agent_runs.tools.runtime_arguments import (
    judge_run_args_from_scene_packet as _judge_run_args_from_scene_packet,
)
from app.domains.agent_runs.tools.runtime_arguments import payload_list as _payload_list
from app.domains.agent_runs.tools.runtime_arguments import (
    proposed_patch_from_repair_patch as _proposed_patch_from_repair_patch,
)
from app.domains.agent_runs.tools.runtime_arguments import required_int as _required_int
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantMessageCreate


class ChapterReviewRuntimeMixin:
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

        # 一次响应只承载一个待确认补丁：拿到第一个可确认 patch 即停。
        # 继续批量 judge.repair 只会落库无人能确认的孤儿补丁，还把 issue 状态改成 requires_rejudge。
        repair_results: list[Any] = []
        remaining_repairable = 0
        for issue in issues:
            issue_id = issue.get("id")
            if not (isinstance(issue_id, int) and _can_repair_issue(issue, review_args["content"])):
                continue
            if _first_patch_payload(repair_results) is not None:
                remaining_repairable += 1
                continue
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
        if remaining_repairable:
            summary += f"另有 {remaining_repairable} 个可修复问题待本补丁确认后再处理。"

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
                "remaining_repairable_issue_count": remaining_repairable,
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
