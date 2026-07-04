"""Agent 工具循环：chat 自由文本走 LLM tool-calling，自主读项目文件后作答。

工具面：只读 fs 工具（fs.list / fs.read / fs.search）+ 一致性（project.consistency 机械观察 /
project.deep_consistency 语义评审）+ 审稿 / 修订 / 起草（file.review / file.revise / file.create）。
写回红线不变：file.revise 只生成待作者确认的 proposed patch，后端绝不写盘。
显式 intent（审稿 / 修订 / 写作任务按钮）继续走旧管线，本模块只服务 chat.explain。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

# W3：live 工具循环直接吃 common 单一出网通道，不再寄生于已降级的 book_runs 私有函数。
from app.common.llm_client import LLMConfigError, LLMError, _call_llm_messages
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import AssistantToolCallCreate, AssistantToolCallUpdate

# Preflight（配置缺失 LLMConfigError）与运行失败（LLMError）平级、都不是彼此子类，循环里要一起接住。
_LLM_ERRORS = (LLMError, LLMConfigError)

LOOP_MAX_ROUNDS = 8
LOOP_TOOL_OUTPUT_BUDGET_CHARS = 60_000
_TOOL_RESULT_MAX_CHARS = 24_000
_HISTORY_MAX_MESSAGES = 12
_HISTORY_MESSAGE_MAX_CHARS = 4_000

# OpenAI function name 不允许点号，对 LLM 暴露下划线名、内部映射回 registry 名。
_TOOL_NAME_MAP = {
    "fs_list": "fs.list",
    "fs_read": "fs.read",
    "fs_search": "fs.search",
    "project_consistency": "project.consistency",
    "project_deep_consistency": "project.deep_consistency",
    "file_review": "file.review",
    "file_revise": "file.revise",
    "file_create": "file.create",
}

# 会产出待确认补丁的工具：一次对话最多一个补丁，生成后这些工具全部撤下。
_PATCH_TOOLS = ("file.revise", "file.create")
_PATCH_TOOL_LLM_NAMES = ("file_revise", "file_create")

_REVIEW_FEEDBACK_MAX_ISSUES = 20
_REVIEW_FEEDBACK_ISSUE_KEYS = ("id", "category", "severity", "code", "message", "suggested_action")

_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇小说创作 agent，工作在作者的本地小说项目上。"
    "你可以调用只读工具查看项目文件：fs_list 列出文件，fs_read 读取文件内容，fs_search 跨文件检索。"
    "检查人物称谓、时间线或重复表达等一致性问题时，用 project_consistency 一次拿到全书观察信号"
    "（词条分布、时间标记、重复子句），再抽读原文核实后下结论。"
    "要对单章做深度一致性检查（正文是否违背人物设定 / 世界观 / 已知事实）时，"
    "用 project_deep_consistency 让语义评审模型把稿件对照人物 / 设定文件核查；"
    "它返回的 issue 是参考信号，回给作者前先抽读对应行核实，不要照单全收。"
    "作者要求审稿时用 file_review 拿多视角结构化意见；要求修改稿件时用 file_revise 生成修订补丁；"
    "要求写新章节 / 新文件时用 file_create 起草（目标文件必须尚不存在，先看清项目结构选好路径）。"
    "补丁不会直接写盘，必须由作者在界面确认；一次对话最多生成一个待确认补丁，不要假设修订或新文件已生效。"
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
    {
        "type": "function",
        "function": {
            "name": "project_consistency",
            "description": (
                "项目级一致性观察扫描：给定人物名 / 称谓 / 设定词条，返回各文件出现分布（含从未出现的缺席词条）、"
                "全书时间标记罗列和跨文件重复子句。只报机械观察不下结论，用于称谓 / 时间线 / 重复表达检查。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "terms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要追踪的人物名 / 称谓 / 设定词条，最多 30 个；可先读设定文件再决定。",
                    },
                    "subpath": {"type": "string", "description": "限定扫描的子目录，相对项目根。"},
                    "glob": {"type": "string", "description": "文件名过滤，默认 *.md。"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "project_deep_consistency",
            "description": (
                "深度一致性评审（语义）：把单个稿件对照项目内人物 / 设定文件交给语义评审模型，"
                "返回结构化 issue（类别 / 严重度 / 行号 / 摘要）。比 project_consistency 更贵更慢，"
                "适合先用机械观察或检索定位疑点、再对目标章节深查；结果是参考信号，须抽读原文核实。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径（要评审的正文）。"},
                    "bible_paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "作为约束的人物 / 设定文件路径；省略则自动取 人物/ 与 设定/ 下的 md 文件。",
                    },
                    "facts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "已核实的必含事实（如「左臂受伤」「地点：灯塔港」），正文与之矛盾会被标出；最多 40 条。",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_review",
            "description": "对项目内单个稿件做多视角审稿（剧情 / 人物 / 文风 / 连续性），返回带稳定 id 的 issue 列表。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径。"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_revise",
            "description": (
                "按明确指示修订项目内单个稿件，生成待作者确认的修订补丁；不会直接写盘。"
                "一次对话最多修订一个文件，修订前建议先 fs_read 或 file_review。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径。"},
                    "instruction": {"type": "string", "description": "修订指示：要改什么、保留什么。"},
                },
                "required": ["path", "instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_create",
            "description": (
                "为项目内尚不存在的新文件起草完整初稿，生成待作者确认的新建文件补丁；不会直接写盘。"
                "目标文件已存在时会失败（改用 file_revise）；起草前建议先读大纲 / 设定 / 相邻章节。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的新文件路径（含目录与 .md 扩展名）。"},
                    "instruction": {"type": "string", "description": "写作指令：写什么、篇幅、衔接哪些既有内容。"},
                },
                "required": ["path", "instruction"],
            },
        },
    },
]


def _offered_schemas(patch_created: bool) -> list[dict[str, Any]]:
    if not patch_created:
        return LOOP_TOOL_SCHEMAS
    return [schema for schema in LOOP_TOOL_SCHEMAS if schema["function"]["name"] not in _PATCH_TOOL_LLM_NAMES]


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
    review_report: dict[str, Any] | None = None
    proposed_patch: dict[str, Any] | None = None
    # 循环被 pause/stop 中断时置位:interruption 为运行时中断 payload，调用方据此收尾不 complete。
    interrupted: bool = False
    interruption: dict[str, Any] | None = None


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
    if registry_name == "project.consistency":
        return {
            "scanned_files": output.get("scanned_files"),
            "term_count": len(output.get("term_occurrences") or []),
            "time_marker_count": len(output.get("time_markers") or []),
            "repeated_clause_count": len(output.get("repeated_clauses") or []),
        }
    if registry_name == "project.deep_consistency":
        return {
            "path": output.get("path"),
            "issue_count": output.get("issue_count"),
            "bible_file_count": len(output.get("bible_files") or []),
        }
    if registry_name == "file.review":
        report = output.get("review_report") if isinstance(output.get("review_report"), dict) else {}
        return {
            "file_path": report.get("file_path"),
            "issue_count": len(report.get("issues") or []),
            "mode": report.get("mode"),
        }
    if registry_name in _PATCH_TOOLS:
        patch = output.get("proposed_patch") if isinstance(output.get("proposed_patch"), dict) else {}
        return {
            "file_path": output.get("file_path"),
            "after_chars": len(str(output.get("after") or "")),
            "model": output.get("model"),
            "patch_id": patch.get("id"),
        }
    return {
        "match_count": len(output.get("matches") or []),
        "scanned_files": output.get("scanned_files"),
        "truncated": output.get("truncated"),
    }


def _review_feedback(output: dict[str, Any]) -> dict[str, Any]:
    """给模型的审稿反馈只保留结构化 issue 要点，不回灌整包 report（含 traces、上下文摘要）。"""

    report = output.get("review_report") if isinstance(output.get("review_report"), dict) else {}
    issues = [issue for issue in (report.get("issues") or []) if isinstance(issue, dict)]
    trimmed = [
        {key: issue.get(key) for key in _REVIEW_FEEDBACK_ISSUE_KEYS if issue.get(key) is not None}
        for issue in issues[:_REVIEW_FEEDBACK_MAX_ISSUES]
    ]
    return {
        "file_path": report.get("file_path"),
        "mode": report.get("mode"),
        "issue_count": len(issues),
        "issues": trimmed,
        "issues_truncated": len(issues) > _REVIEW_FEEDBACK_MAX_ISSUES,
        "suggested_actions": report.get("suggested_actions"),
    }


def _revise_feedback(output: dict[str, Any]) -> dict[str, Any]:
    """修订反馈不携带 before/after 全文：既省预算，也防模型把未确认补丁当已写回事实。"""

    return {
        "status": "proposed_patch_created",
        "file_path": output.get("file_path"),
        "summary": output.get("summary"),
        "applied_scope": output.get("applied_scope"),
        "note": "修订补丁已生成，等待作者在界面确认后才会写盘；不要假设已写回。",
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
    should_interrupt: Callable[[str], dict[str, Any] | None] | None = None,
) -> ChatLoopOutcome:
    """LLM 工具循环主体。execute_fs_tool 抛出的异常消息会作为工具错误反馈给模型。

    首轮 LLM 调用失败抛 ChatLoopUnavailableError（调用方回落单轮对话）；
    后续轮失败则以错误说明收尾，不吞掉部分进展。

    should_interrupt 在每轮开头调用（入参为 boundary 字符串）：返回非 None 的运行时中断
    payload 时，循环立即收尾（run 已被 pause/stop），不再发起新一轮模型调用。"""

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
            result = _call_llm_messages(
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
                messages.append({"role": "tool", "tool_call_id": call_id, "content": json.dumps({"error": error_text}, ensure_ascii=False)})
                continue

            if registry_name == "file.review":
                if isinstance(output.get("review_report"), dict):
                    outcome.review_report = output["review_report"]
                feedback = _review_feedback(output)
            elif registry_name in _PATCH_TOOLS:
                if isinstance(output.get("proposed_patch"), dict):
                    outcome.proposed_patch = output["proposed_patch"]
                feedback = _revise_feedback(output)
            else:
                feedback = output
            serialized = _serialize_tool_output(feedback)
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
