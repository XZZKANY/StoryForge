"""Agent 工具循环：chat 自由文本走 LLM tool-calling，自主读项目文件后作答。

工具面：只读 fs 工具（fs.list / fs.read / fs.search）+ 一致性（project.consistency 机械观察 /
project.deep_consistency 语义评审）+ 审稿 / 修订 / 起草（file.review / file.revise / file.create）。
写回红线不变：file.revise 只生成待作者确认的 proposed patch，后端绝不写盘。
显式 intent（审稿 / 修订 / 写作任务按钮）继续走旧管线，本模块只服务 chat.explain。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

# W3：live 工具循环直接吃 common 单一出网通道，不再寄生于已降级的 book_runs 私有函数。
from app.common.llm_client import LLMConfigError, LLMError
from app.common.llm_client import call_llm_messages as _call_llm_messages
from app.domains.agent_runs.canon_context import build_scene_constraint_block
from app.domains.agent_runs.loop import prompt_context as loop_prompt_context
from app.domains.agent_runs.loop.support import (
    history_messages as _history_messages,
)
from app.domains.agent_runs.loop.support import (
    merge_cost_breakdown as _merge_cost_breakdown,
)
from app.domains.agent_runs.loop.support import (
    parse_tool_arguments as _parse_tool_arguments,
)
from app.domains.agent_runs.loop.support import (
    review_feedback as _review_feedback,
)
from app.domains.agent_runs.loop.support import (
    revise_feedback as _revise_feedback,
)
from app.domains.agent_runs.loop.support import (
    serialize_tool_output as _serialize_tool_output,
)
from app.domains.agent_runs.loop.support import (
    tool_output_summary as _tool_output_summary,
)
from app.domains.agent_runs.loop.types import ChatLoopOutcome, LoopRoundResult, LoopToolCall, LoopToolFeedback
from app.domains.agent_runs.tools import (
    build_loop_tool_name_map,
    build_loop_tool_schemas,
    llm_tool_name,
    loop_patch_tool_specs,
)
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantToolCallCreate, AssistantToolCallUpdate

_AUTHOR_INSTRUCTIONS_MAX_CHARS = loop_prompt_context.AUTHOR_INSTRUCTIONS_MAX_CHARS
_AUTHOR_INSTRUCTIONS_PREFIX = loop_prompt_context.AUTHOR_INSTRUCTIONS_PREFIX
_SYSTEM_PROMPT = loop_prompt_context.SYSTEM_PROMPT
_read_author_instructions = loop_prompt_context.read_author_instructions

# Preflight（配置缺失 LLMConfigError）与运行失败（LLMError）平级、都不是彼此子类，循环里要一起接住。
_LLM_ERRORS = (LLMError, LLMConfigError)
LOOP_MAX_ROUNDS = 8
LOOP_TOOL_OUTPUT_BUDGET_CHARS = 60_000

# OpenAI function name 不允许点号，对 LLM 暴露下划线名、内部映射回 registry 名（从 spec 单点派生）。
_TOOL_NAME_MAP = build_loop_tool_name_map()

# 会产出待确认补丁的工具：一次对话最多一个补丁，生成后这些工具全部撤下（从 spec 单点派生）。
_PATCH_TOOLS = tuple(spec.name for spec in loop_patch_tool_specs())
_PATCH_TOOL_LLM_NAMES = tuple(llm_tool_name(spec.name) for spec in loop_patch_tool_specs())



# 作者自定义指令：写盘即生效追加进 system prompt，让作者不改代码即可定制 agent 语气 / 偏好 / 审稿口径。




# LOOP_TOOL_SCHEMAS 从 spec 单点派生（见 tooling.build_loop_tool_schemas），删掉此前手写镜像。
LOOP_TOOL_SCHEMAS: list[dict[str, Any]] = build_loop_tool_schemas()


def _offered_schemas(patch_created: bool) -> list[dict[str, Any]]:
    if not patch_created:
        return LOOP_TOOL_SCHEMAS
    return [schema for schema in LOOP_TOOL_SCHEMAS if schema["function"]["name"] not in _PATCH_TOOL_LLM_NAMES]


class ChatLoopUnavailableError(RuntimeError):
    """首轮 LLM 调用即失败（如 provider 不支持 tools / 环境不完整），应回落单轮对话。"""


















def run_chat_loop(
    session: Session,
    *,
    llm_env: dict[str, str | None],
    assistant_session_id: int,
    user_message: str,
    project_path: str,
    current_file: str | None,
    execute_fs_tool: Callable[[str, dict[str, Any]], dict[str, Any]],
    on_trace: Callable[[AgentToolTrace], None],
    should_interrupt: Callable[[str], dict[str, Any] | None] | None = None,
) -> ChatLoopOutcome:
    """LLM 工具循环主体。execute_fs_tool 抛出的异常消息会作为工具错误反馈给模型。

    首轮 LLM 调用失败抛 ChatLoopUnavailableError（调用方回落单轮对话）；
    后续轮失败则以错误说明收尾，不吞掉部分进展。

    should_interrupt 在每轮开头调用（入参为 boundary 字符串）：返回非 None 的运行时中断
    payload 时，循环立即收尾（run 已被 pause/stop），不再发起新一轮模型调用。"""

    history = _history_messages(session, assistant_session_id)
    current_file_hint = f"当前打开文件：{current_file}" if current_file else "当前没有打开文件"
    scene_block = build_scene_constraint_block(project_path, current_file)
    author_instructions = _read_author_instructions(project_path)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        *(
            [{"role": "system", "content": _AUTHOR_INSTRUCTIONS_PREFIX + author_instructions}]
            if author_instructions
            else []
        ),
        *history,
        *([{"role": "system", "content": scene_block}] if scene_block else []),
        {
            "role": "user",
            "content": f"[项目已挂载，只读工具可用。{current_file_hint}]\n作者：{user_message}",
        },
    ]

    outcome = ChatLoopOutcome(answer="")
    tool_output_chars = 0
    trace_index = 0

    for round_number in range(1, LOOP_MAX_ROUNDS + 1):
        outcome.rounds = round_number
        # 每轮开头读 run.status：作者点暂停/停止后不再烧新一轮 BYO-key，交调用方收尾落库。
        if should_interrupt is not None:
            interruption = should_interrupt(f"before_round:{round_number}")
            if interruption is not None:
                outcome.interrupted = True
                outcome.interruption = interruption
                outcome.answer = outcome.answer or "已按你的操作停下，这轮没有继续。"
                return outcome
        budget_exhausted = tool_output_chars >= LOOP_TOOL_OUTPUT_BUDGET_CHARS
        final_round = round_number == LOOP_MAX_ROUNDS
        # 末轮或预算耗尽时不再给工具，强制模型基于已有信息作答。
        offer_tools = not (final_round or budget_exhausted)
        if budget_exhausted:
            messages.append(
                {"role": "system", "content": "工具输出预算已用完，请基于已获得的信息直接回答作者。"}
            )
        try:
            result_payload = _call_llm_messages(
                llm_env,
                messages=messages,
                tools=_offered_schemas(outcome.proposed_patch is not None) if offer_tools else None,
            )
        except _LLM_ERRORS as exc:
            if round_number == 1:
                raise ChatLoopUnavailableError(str(exc)) from exc
            outcome.answer = f"这轮查到一半模型调用失败了：{str(exc)[:300]}"
            outcome.exhausted = True
            return outcome

        round_result = LoopRoundResult.from_payload(result_payload)
        if round_result.completion_tokens is not None:
            outcome.completion_tokens += round_result.completion_tokens
        if round_result.prompt_tokens is not None:
            outcome.prompt_tokens += round_result.prompt_tokens
        if round_result.token_usage is not None:
            outcome.token_usage += round_result.token_usage
        if round_result.token_usage_source is not None:
            if outcome.token_usage_source == "unavailable":
                outcome.token_usage_source = round_result.token_usage_source
            elif outcome.token_usage_source != round_result.token_usage_source:
                outcome.token_usage_source = "mixed"
        if round_result.cost_cny_estimated is not None:
            outcome.cost_cny_estimated += round_result.cost_cny_estimated
        outcome.cost_breakdown = _merge_cost_breakdown(
            outcome.cost_breakdown,
            round_result.cost_breakdown,
            prompt_tokens=outcome.prompt_tokens,
            completion_tokens=outcome.completion_tokens,
            token_usage_source=outcome.token_usage_source,
        )
        content = round_result.content
        tool_calls = round_result.tool_calls

        if not tool_calls:
            outcome.answer = content
            return outcome

        messages.append(
            {"role": "assistant", "content": content or None, "tool_calls": tool_calls}
        )
        for raw_tool_call in tool_calls:
            tool_call = LoopToolCall.from_payload(raw_tool_call, fallback_id=f"call_{trace_index}")
            registry_name = _TOOL_NAME_MAP.get(tool_call.llm_tool_name)
            outcome.tool_call_count += 1

            if registry_name is None:
                error_text = f"未知工具：{tool_call.llm_tool_name}，可用工具为 fs_list / fs_read / fs_search。"
                trace = AgentToolTrace(
                    tool_name=tool_call.llm_tool_name or "unknown",
                    status="failed",
                    input_summary={"arguments": tool_call.arguments_json[:500]},
                    error_message=error_text,
                )
                outcome.traces.append(trace)
                on_trace(trace)
                trace_index += 1
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.call_id,
                        "content": json.dumps({"error": error_text}, ensure_ascii=False),
                    }
                )
                continue

            try:
                arguments = _parse_tool_arguments(tool_call.arguments_json)
            except (json.JSONDecodeError, ValueError) as exc:
                arguments = None
                failure = f"工具参数解析失败：{exc}"
            else:
                failure = None

            if failure is None and registry_name in _PATCH_TOOLS and outcome.proposed_patch is not None:
                failure = "一次对话最多生成一个待确认补丁：请先等作者处理当前补丁，再发起新的修订或起草。"

            evidence = assistant_service.create_assistant_tool_call(
                session,
                assistant_session_id,
                AssistantToolCallCreate(
                    tool_name=registry_name,
                    status="running",
                    input_summary={key: value for key, value in (arguments or {}).items() if key != "content"},
                ),
            )

            if failure is None:
                assert arguments is not None
                try:
                    output = execute_fs_tool(registry_name, arguments)
                except Exception as exc:  # noqa: BLE001 - 工具失败要作为观测反馈给模型，不中断循环
                    failure = str(exc)[:500]
                    output = None
            else:
                output = None

            if failure is not None or output is None:
                error_text = failure or "工具执行失败。"
                assistant_service.update_assistant_tool_call(
                    session,
                    evidence.id,
                    AssistantToolCallUpdate(status="failed", error_message=error_text[:4000]),
                )
                trace = AgentToolTrace(
                    tool_name=registry_name,
                    status="failed",
                    input_summary=dict(arguments or {}),
                    error_message=error_text,
                    assistant_tool_call_id=evidence.id,
                )
                outcome.traces.append(trace)
                on_trace(trace)
                trace_index += 1
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.call_id,
                        "content": json.dumps({"error": error_text}, ensure_ascii=False),
                    }
                )
                continue

            feedback = LoopToolFeedback.from_output(
                registry_name,
                output,
                patch_tools=_PATCH_TOOLS,
                review_feedback=_review_feedback,
                revise_feedback=_revise_feedback,
            )
            if feedback.review_report is not None:
                outcome.review_report = feedback.review_report
            if feedback.patch_proposal is not None:
                outcome.patch_proposal = feedback.patch_proposal
            serialized = _serialize_tool_output(feedback.content)
            tool_output_chars += len(serialized)
            output_summary = _tool_output_summary(registry_name, output)
            assistant_service.update_assistant_tool_call(
                session,
                evidence.id,
                AssistantToolCallUpdate(status="completed", output_summary=output_summary),
            )
            trace = AgentToolTrace(
                tool_name=registry_name,
                status="completed",
                input_summary=dict(arguments or {}),
                output_summary=output_summary,
                assistant_tool_call_id=evidence.id,
            )
            outcome.traces.append(trace)
            on_trace(trace)
            trace_index += 1
            messages.append({"role": "tool", "tool_call_id": tool_call.call_id, "content": serialized})

    # 理论不可达：末轮 offer_tools=False，_call_llm_messages 无 tool_calls 必然给正文并 return。
    outcome.answer = outcome.answer or "本轮工具调用达到上限，我还没收敛出结论；把问题聚焦到具体章节或文件再问我一次。"
    outcome.exhausted = True
    return outcome
