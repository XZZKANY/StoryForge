"""Agent 工具循环：chat 自由文本走 LLM tool-calling，自主读项目文件后作答。

只挂只读 fs 工具（fs.list / fs.read / fs.search），写回仍走 proposed patch 前端确认。
显式 intent（审稿 / 修订 / 写作任务按钮）继续走旧管线，本模块只服务 chat.explain。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantToolCallCreate, AssistantToolCallUpdate
from app.domains.book_runs.book_generation_llm import _call_llm_messages
from app.domains.book_runs.errors import BookGenerationError, BookGenerationPreflightError

# Preflight（配置缺失）与运行失败平级、都不是彼此子类，循环里要一起接住。
_LLM_ERRORS = (BookGenerationError, BookGenerationPreflightError)

LOOP_MAX_ROUNDS = 8
LOOP_TOOL_OUTPUT_BUDGET_CHARS = 60_000
_TOOL_RESULT_MAX_CHARS = 24_000
_HISTORY_MAX_MESSAGES = 12
_HISTORY_MESSAGE_MAX_CHARS = 4_000

# OpenAI function name 不允许点号，对 LLM 暴露下划线名、内部映射回 registry 名。
_TOOL_NAME_MAP = {"fs_list": "fs.list", "fs_read": "fs.read", "fs_search": "fs.search"}

_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇小说创作 agent，工作在作者的本地小说项目上。"
    "你可以调用只读工具查看项目文件：fs_list 列出文件，fs_read 读取文件内容，fs_search 跨文件检索。"
    "回答作者问题前，先用工具把需要的事实查清楚再作答，不要编造项目里不存在的内容；"
    "项目里查不到时直说查不到。工具结果可能被截断（truncated=true），"
    "需要更多内容就调整 offset 或缩小范围继续读。"
    "最终回答用简洁自然的中文，直接说事；引用文件时给出相对路径。"
)

LOOP_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "fs_list",
            "description": "列出项目内文件（递归、相对路径）。可选 subpath 限定子目录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "subpath": {"type": "string", "description": "限定列出的子目录，相对项目根。"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fs_read",
            "description": "读取项目内单个文本文件的内容切片。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的文件路径。"},
                    "offset": {"type": "integer", "description": "起始字符偏移，默认 0。"},
                    "limit": {"type": "integer", "description": "最多返回字符数，默认 20000。"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fs_search",
            "description": "在项目文本文件里跨文件检索，返回文件、行号和摘录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "要检索的文本或正则。"},
                    "glob": {"type": "string", "description": "文件名过滤，默认 *.md。"},
                    "use_regex": {"type": "boolean", "description": "query 是否按正则解释，默认 false。"},
                },
                "required": ["query"],
            },
        },
    },
]


class ChatLoopUnavailableError(RuntimeError):
    """首轮 LLM 调用即失败（如 provider 不支持 tools / 环境不完整），应回落单轮对话。"""


@dataclass
class ChatLoopOutcome:
    answer: str
    traces: list[AgentToolTrace] = field(default_factory=list)
    rounds: int = 0
    tool_call_count: int = 0
    completion_tokens: int = 0
    exhausted: bool = False


def _serialize_tool_output(output: dict[str, Any]) -> str:
    text = json.dumps(output, ensure_ascii=False)
    if len(text) > _TOOL_RESULT_MAX_CHARS:
        return text[:_TOOL_RESULT_MAX_CHARS] + "…[结果过长已截断]"
    return text


def _parse_tool_arguments(raw: str) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("工具参数必须是 JSON 对象。")
    return parsed


def _history_messages(session: Session, assistant_session_id: int) -> list[dict[str, Any]]:
    record = assistant_service.get_assistant_session(session, assistant_session_id)
    history: list[dict[str, Any]] = []
    for message in record.messages[-_HISTORY_MAX_MESSAGES:]:
        if message.role not in ("user", "assistant"):
            continue
        history.append({"role": message.role, "content": message.content[:_HISTORY_MESSAGE_MAX_CHARS]})
    return history


def _tool_output_summary(registry_name: str, output: dict[str, Any]) -> dict[str, Any]:
    if registry_name == "fs.list":
        return {"entry_count": len(output.get("entries") or []), "truncated": output.get("truncated")}
    if registry_name == "fs.read":
        return {
            "path": output.get("path"),
            "returned_chars": output.get("returned_chars"),
            "truncated": output.get("truncated"),
        }
    return {
        "match_count": len(output.get("matches") or []),
        "scanned_files": output.get("scanned_files"),
        "truncated": output.get("truncated"),
    }


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
) -> ChatLoopOutcome:
    """LLM 工具循环主体。execute_fs_tool 抛出的异常消息会作为工具错误反馈给模型。

    首轮 LLM 调用失败抛 ChatLoopUnavailableError（调用方回落单轮对话）；
    后续轮失败则以错误说明收尾，不吞掉部分进展。"""

    history = _history_messages(session, assistant_session_id)
    current_file_hint = f"当前打开文件：{current_file}" if current_file else "当前没有打开文件"
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        *history,
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
        budget_exhausted = tool_output_chars >= LOOP_TOOL_OUTPUT_BUDGET_CHARS
        final_round = round_number == LOOP_MAX_ROUNDS
        # 末轮或预算耗尽时不再给工具，强制模型基于已有信息作答。
        offer_tools = not (final_round or budget_exhausted)
        if budget_exhausted:
            messages.append(
                {"role": "system", "content": "工具输出预算已用完，请基于已获得的信息直接回答作者。"}
            )
        try:
            result = _call_llm_messages(
                llm_env,
                messages=messages,
                tools=LOOP_TOOL_SCHEMAS if offer_tools else None,
            )
        except _LLM_ERRORS as exc:
            if round_number == 1:
                raise ChatLoopUnavailableError(str(exc)) from exc
            outcome.answer = f"这轮查到一半模型调用失败了：{str(exc)[:300]}"
            outcome.exhausted = True
            return outcome

        completion_tokens = result.get("completion_tokens")
        if isinstance(completion_tokens, int):
            outcome.completion_tokens += completion_tokens
        content = str(result.get("content") or "")
        tool_calls = result.get("tool_calls") if isinstance(result.get("tool_calls"), list) else []

        if not tool_calls:
            outcome.answer = content
            return outcome

        messages.append(
            {"role": "assistant", "content": content or None, "tool_calls": tool_calls}
        )
        for tool_call in tool_calls:
            call_id = str(tool_call.get("id") or f"call_{trace_index}")
            function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
            llm_tool_name = str(function.get("name") or "")
            registry_name = _TOOL_NAME_MAP.get(llm_tool_name)
            outcome.tool_call_count += 1

            if registry_name is None:
                error_text = f"未知工具：{llm_tool_name}，可用工具为 fs_list / fs_read / fs_search。"
                trace = AgentToolTrace(
                    tool_name=llm_tool_name or "unknown",
                    status="failed",
                    input_summary={"arguments": str(function.get("arguments") or "")[:500]},
                    error_message=error_text,
                )
                outcome.traces.append(trace)
                on_trace(trace)
                trace_index += 1
                messages.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps({"error": error_text}, ensure_ascii=False)})
                continue

            try:
                arguments = _parse_tool_arguments(str(function.get("arguments") or ""))
            except (json.JSONDecodeError, ValueError) as exc:
                arguments = None
                failure = f"工具参数解析失败：{exc}"
            else:
                failure = None

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
                messages.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps({"error": error_text}, ensure_ascii=False)})
                continue

            serialized = _serialize_tool_output(output)
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
            messages.append({"role": "tool", "tool_call_id": call_id, "content": serialized})

    # 理论不可达：末轮 offer_tools=False，_call_llm_messages 无 tool_calls 必然给正文并 return。
    outcome.answer = outcome.answer or "本轮工具调用达到上限，我还没收敛出结论；把问题聚焦到具体章节或文件再问我一次。"
    outcome.exhausted = True
    return outcome
