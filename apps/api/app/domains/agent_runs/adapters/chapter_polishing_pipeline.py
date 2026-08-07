from __future__ import annotations

from typing import Any

from app.domains.agent_runs.adapters.intent_fixed_pipeline_adapter import FixedPipelineRequest
from app.domains.agent_runs.events.runtime_support import base_response as _base_response
from app.domains.agent_runs.events.runtime_support import plan_step as _plan_step
from app.domains.agent_runs.intent import role_hints as _role_hints
from app.domains.agent_runs.intent import role_mentions as _role_mentions
from app.domains.agent_runs.tools import ToolExecutionContext


class ControlledChapterPolishingRuntimeMixin:
    def run_controlled_chapter_polish_pipeline(
        self, request: FixedPipelineRequest
    ) -> dict[str, Any]:
        tool_context = ToolExecutionContext(
            request.session,
            request.run,
            request.agent_session_id,
            request.assistant_session_id,
            request.user_message,
            request.args,
        )
        context = self._execute_tool(
            "context.load",
            tool_context,
            {**request.args, "_agent_intent": request.intent},
        )
        polish = self._execute_tool(
            "chapter.polish",
            tool_context,
            {
                **request.args,
                **context.output,
                "style_instruction": request.args.get("style_instruction") or "",
                "use_main_model": request.args.get("use_main_model") is True,
                "online_enabled": request.args.get("online_enabled") is not False,
            },
        )
        proposed_patch = (
            polish.output.get("proposed_patch")
            if isinstance(polish.output.get("proposed_patch"), dict)
            else None
        )
        requires_confirmation = bool(
            proposed_patch and proposed_patch.get("requires_confirmation", True)
        )
        plan = [
            _plan_step("context.load", "读取当前章与可信项目上下文。", "completed"),
            _plan_step("chapter.polish", "比较在线与本地候选并执行相对原文质量门禁。", "completed"),
        ]
        if proposed_patch is not None:
            plan.append(
                _plan_step(
                    "permission.confirm",
                    "文件写回前等待作者确认。"
                    if requires_confirmation
                    else "按项目权限交给 Desktop guarded writeback。",
                    "needs_approval" if requires_confirmation else "completed",
                )
            )
        return _base_response(
            agent_session_id=request.agent_session_id,
            assistant_session_id=request.assistant_session_id,
            intent="chapter.polish",
            user_message=request.user_message,
            plan=plan,
            agent_result={
                "summary": polish.output["summary"],
                "requires_user_confirmation": requires_confirmation,
                "polish": {
                    key: polish.output.get(key)
                    for key in (
                        "status",
                        "selected_source",
                        "degraded",
                        "provider",
                        "model",
                        "resolution_source",
                        "online_failure",
                        "rule_version",
                        "gate_version",
                        "gate_reasons",
                    )
                },
            },
            tool_trace=[context.trace, polish.trace],
            proposed_patch=proposed_patch,
            role_hints=_role_hints(request.args),
            role_mentions=_role_mentions(request.args),
            tool_artifacts=list(polish.artifacts),
        )
