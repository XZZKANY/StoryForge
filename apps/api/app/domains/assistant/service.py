from __future__ import annotations

import json
import time
from collections.abc import Iterator, Mapping
from typing import Any
from urllib import error, request

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.common.author_voice import build_generation_system_prompt
from app.common.craft import (
    craft_prompt_clause,
    scene_discipline_clause,
    scene_discipline_guard_clause,
)
from app.common.exceptions import DomainError, NotFoundError
from app.common.llm_client import LLMError, build_chat_payload, stream_chat_completions
from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.assistant import continuation
from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
from app.domains.assistant.schemas import (
    AssistantContinueRequest,
    AssistantDraftRequest,
    AssistantDraftResponse,
    AssistantMessageCreate,
    AssistantReviseRequest,
    AssistantReviseResponse,
    AssistantSessionCreate,
    AssistantToolCallCreate,
    AssistantToolCallUpdate,
    ProviderHealthResponse,
)
from app.domains.book_runs.book_generation import (
    BookGenerationError,
    BookGenerationPreflightError,
    missing_book_generation_env,
    resolved_llm_env,
)
from app.domains.book_runs.book_generation import (
    call_llm as _call_llm,
)
from app.domains.book_runs.book_generation import (
    env_value as _env_value,
)
from app.domains.book_runs.book_generation import (
    llm_request_headers as _llm_request_headers,
)
from app.domains.book_runs.book_generation import (
    optional_float as _optional_float,
)
from app.domains.book_runs.book_generation import (
    required_env as _required_env,
)


class AssistantSessionNotFoundError(NotFoundError, RuntimeError):
    """找不到指定 Assistant 会话。"""


class AssistantToolCallNotFoundError(NotFoundError, RuntimeError):
    """找不到指定 Assistant 工具调用。"""


class AssistantLlmNotConfiguredError(DomainError, RuntimeError):
    """真实 LLM 环境变量未配置，无法执行修订。"""

    status_code = 422

    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__("真实 LLM 未配置，缺少环境变量：" + ", ".join(missing))


class AssistantReviseError(DomainError, RuntimeError):
    """真实 LLM 修订调用失败，原始报错原样透出。"""

    status_code = 502


def create_assistant_session(session: Session, payload: AssistantSessionCreate) -> AssistantSession:
    """创建可追溯 Assistant 会话，不接收也不保存敏感凭据。"""

    assistant_session = AssistantSession(
        title=redact_sensitive_text(payload.title),
        task_type=payload.task_type,
        project_path=payload.project_path,
        blueprint_id=payload.blueprint_id,
        book_run_id=payload.book_run_id,
        artifact_id=payload.artifact_id,
    )
    assistant_session.messages = [
        AssistantMessage(role=message.role, content=redact_sensitive_text(message.content)) for message in payload.messages
    ]
    session.add(assistant_session)
    session.commit()
    return get_assistant_session(session, assistant_session.id)


def append_assistant_message(
    session: Session,
    assistant_session_id: int,
    payload: AssistantMessageCreate,
) -> AssistantMessage:
    """向已有会话追加一条消息。"""

    assistant_session = get_assistant_session(session, assistant_session_id)
    message = AssistantMessage(
        session_id=assistant_session.id,
        role=payload.role,
        content=redact_sensitive_text(payload.content),
    )
    session.add(message)
    session.commit()
    session.refresh(message)
    return message


def create_assistant_tool_call(
    session: Session,
    assistant_session_id: int,
    payload: AssistantToolCallCreate,
) -> AssistantToolCall:
    """为 Assistant 会话追加一条工具调用事实。"""

    assistant_session = get_assistant_session(session, assistant_session_id)
    tool_call_data = _redact_tool_call_data(payload.model_dump())
    tool_call = AssistantToolCall(session_id=assistant_session.id, **tool_call_data)
    session.add(tool_call)
    session.commit()
    session.refresh(tool_call)
    return tool_call


def update_assistant_tool_call(
    session: Session,
    tool_call_id: int,
    payload: AssistantToolCallUpdate,
) -> AssistantToolCall:
    """更新工具调用状态和摘要，保留未提交字段。"""

    tool_call = session.get(AssistantToolCall, tool_call_id)
    if tool_call is None:
        raise AssistantToolCallNotFoundError(f"Assistant 工具调用不存在：{tool_call_id}。")
    for key, value in _redact_tool_call_data(payload.model_dump(exclude_unset=True)).items():
        setattr(tool_call, key, value)
    session.add(tool_call)
    session.commit()
    session.refresh(tool_call)
    return tool_call


def list_assistant_tool_calls(session: Session, assistant_session_id: int) -> list[AssistantToolCall]:
    """按创建顺序读取会话内工具调用事实，用于重放工具树。"""

    assistant_session = get_assistant_session(session, assistant_session_id)
    return list(
        session.scalars(
            select(AssistantToolCall)
            .where(AssistantToolCall.session_id == assistant_session.id)
            .order_by(AssistantToolCall.id.asc())
        )
    )


def _redact_tool_call_data(data: dict[str, Any]) -> dict[str, Any]:
    redacted = dict(data)
    for key in ("input_summary", "output_summary"):
        value = redacted.get(key)
        if isinstance(value, dict):
            redacted[key] = redact_sensitive(value)
    error_message = redacted.get("error_message")
    if isinstance(error_message, str):
        redacted["error_message"] = redact_sensitive_text(error_message)
    return redacted


def get_assistant_session(session: Session, assistant_session_id: int) -> AssistantSession:
    assistant_session = session.scalar(
        select(AssistantSession)
        .options(selectinload(AssistantSession.messages))
        .where(AssistantSession.id == assistant_session_id)
    )
    if assistant_session is None:
        raise AssistantSessionNotFoundError(f"Assistant 会话不存在：{assistant_session_id}。")
    return assistant_session


def list_recent_assistant_sessions(
    session: Session,
    *,
    limit: int = 20,
    project_path: str | None = None,
) -> list[AssistantSession]:
    """按更新时间倒序读取最近 Assistant 会话，可按项目路径过滤。"""

    statement = select(AssistantSession).options(selectinload(AssistantSession.messages))
    if project_path is not None:
        statement = statement.where(AssistantSession.project_path == project_path)
    return list(
        session.scalars(
            statement.order_by(AssistantSession.updated_at.desc(), AssistantSession.id.desc()).limit(limit)
        )
    )


_REVISE_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇创作编辑。"
    "用户会给你一份正在编辑的文件全文与一条修订指令。"
    "请严格按指令修订，保持原有结构、人物与设定的连贯性。"
    "默认只改动指令直接涉及的部分，未点名的段落、句子与标题尽量逐字保留，不要无谓改写或扩大改动范围。"
    + craft_prompt_clause()
    + "创作准则约束的是你这次落笔改写的那些句子；它不构成扩大改动范围的理由，"
    "未点名段落即便不合准则也保持原样，由作者另行提出。"
    + scene_discipline_guard_clause()
    + "只输出修订后的完整正文，不要输出解释、前后缀或代码块标记。"
)


def _build_revise_prompt(payload: AssistantReviseRequest) -> str:
    project_line = f"项目：{payload.project_name}\n" if payload.project_name else ""
    context_block = ""
    if payload.context_bundle and payload.context_bundle.files:
        context_entries = []
        for item in payload.context_bundle.files:
            context_entries.append(
                "\n".join(
                    [
                        f"### {item.relative_path}",
                        f"- 类型：{item.kind}",
                        "<<<CONTEXT",
                        item.excerpt,
                        "CONTEXT>>>",
                    ]
                )
            )
        context_block = (
            "\n项目上下文摘录：这些文件来自同一小说项目，请用于保持大纲、人物、设定与正文连贯；"
            "如果摘录与当前文件冲突，优先保留明确的当前文件事实，并在修订中避免扩大矛盾。\n"
            + "\n\n".join(context_entries)
            + "\n"
        )
    return (
        f"{project_line}"
        f"文件：{payload.file_path}\n"
        f"修订指令：{payload.instruction}\n\n"
        f"{context_block}"
        "以下是文件的当前全文，请按指令修订后整体返回：\n"
        "<<<FILE\n"
        f"{payload.content}\n"
        "FILE>>>"
    )


_CHAT_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇小说创作助手，在作者的整个项目上协作。"
    "作者会围绕这个项目（大纲、人物、设定、时间线、各章正文）跟你对话——提问、讨论走向、让你审读或出主意。"
    "依据提供的项目上下文回答；上下文不足以支撑结论时，直说你还需要看哪些文件或章节，不要编造情节、人物或设定。"
    "回答用简洁自然的中文，直接说事，不堆前后缀，也不要整段回抄原文。"
)


def _build_chat_prompt(user_message: str, context_block: str) -> str:
    if context_block:
        return (
            "以下是当前项目的上下文摘录（可能不完整，仅供理解作者在写什么）：\n"
            f"{context_block}\n\n"
            f"作者：{user_message}"
        )
    return f"（暂无项目上下文摘录。）\n\n作者：{user_message}"


def chat_reply(
    session: Session,
    *,
    user_message: str,
    context_block: str,
    assistant_session_id: int,
) -> dict[str, Any]:
    """就项目做一次真实 LLM 对话回复，并落工具调用证据链。

    LLM 未配置或调用失败时明确抛错，不伪造兜底内容。"""

    llm_env = resolved_llm_env()
    missing = missing_book_generation_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    tool_call = create_assistant_tool_call(
        session,
        assistant_session_id,
        AssistantToolCallCreate(
            tool_name="assistant.chat",
            status="running",
            input_summary={
                "message": user_message[:500],
                "context_chars": len(context_block),
            },
        ),
    )

    try:
        result = _call_llm(
            llm_env,
            system_prompt=_CHAT_SYSTEM_PROMPT,
            user_prompt=_build_chat_prompt(user_message, context_block),
        )
    except BookGenerationError as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(status="failed", error_message=str(exc)[:4000]),
        )
        raise AssistantReviseError(str(exc)) from exc

    reply = str(result["content"]).strip()
    model = str(llm_env.get("STORYFORGE_LLM_MODEL") or "")
    update_assistant_tool_call(
        session,
        tool_call.id,
        AssistantToolCallUpdate(
            status="completed",
            output_summary={
                "reply_chars": len(reply),
                "model": model,
                "prompt_tokens": result.get("prompt_tokens"),
                "completion_tokens": result.get("completion_tokens"),
                "token_usage": result.get("token_usage"),
                "cost_cny_estimated": result.get("cost_cny_estimated"),
                "cost_breakdown": result.get("cost_breakdown"),
                "token_usage_source": result.get("token_usage_source"),
            },
        ),
    )
    return {
        "reply": reply,
        "model": model,
        "completion_tokens": result.get("completion_tokens"),
        "latency_ms": int(result.get("latency_ms", 0) or 0),
    }


def _sse(event: str, data: dict[str, Any]) -> str:
    """SSE 帧编码。本地实现而非引 ide.run_events，避免新增 assistant → ide 域边。"""

    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _continue_scene_constraints(payload: AssistantContinueRequest) -> str | None:
    if not payload.project_root:
        return None
    # 延迟导入：agent_runs 在模块顶层 import 本模块（file.create 走 draft_file_content），
    # 顶层反向引用会成环。
    from app.domains.agent_runs import canon_context

    try:
        return canon_context.build_scene_constraint_block(payload.project_root, payload.file_path)
    except Exception:  # noqa: BLE001 - canon 缺失或损坏绝不能挡住作者继续写
        return None


def stream_continue_prose(session: Session, payload: AssistantContinueRequest) -> Iterator[str]:
    """光标处续写：同步做前置校验与证据链落库，返回逐块吐字的 SSE 生成器。

    外层刻意不是生成器——LLM 未配置必须在 StreamingResponse 建立之前抛成 422，否则错误
    只能裹在流里以 200 送出，前端拿不到状态码。
    """

    llm_env = resolved_llm_env()
    missing = missing_book_generation_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    tail = continuation.manuscript_tail(payload.content, payload.cursor_line)
    target_chars = payload.target_chars or continuation.DEFAULT_TARGET_CHARS
    scene_constraints = _continue_scene_constraints(payload)
    instruction_label = payload.instruction or f"续写 {payload.file_path}"

    if payload.assistant_session_id is not None:
        assistant_session = get_assistant_session(session, payload.assistant_session_id)
        append_assistant_message(
            session,
            assistant_session.id,
            AssistantMessageCreate(role="user", content=instruction_label),
        )
    else:
        assistant_session = create_assistant_session(
            session,
            AssistantSessionCreate(
                title=f"续写 {payload.file_path}"[:160],
                task_type="desktop_continue",
                messages=[AssistantMessageCreate(role="user", content=instruction_label)],
            ),
        )

    tool_call = create_assistant_tool_call(
        session,
        assistant_session.id,
        AssistantToolCallCreate(
            tool_name="assistant.continue",
            status="running",
            input_summary={
                "file_path": payload.file_path,
                "cursor_line": payload.cursor_line,
                "tail_chars": len(tail),
                "target_chars": target_chars,
                "has_instruction": payload.instruction is not None,
                "has_scene_constraints": scene_constraints is not None,
            },
        ),
    )

    request_payload = build_chat_payload(
        llm_env,
        messages=[
            {
                "role": "system",
                "content": build_generation_system_prompt(
                    continuation.CONTINUE_SYSTEM_PROMPT, payload.project_root
                ),
            },
            {
                "role": "user",
                "content": continuation.build_continue_prompt(
                    tail=tail,
                    file_path=payload.file_path,
                    instruction=payload.instruction,
                    scene_constraints=scene_constraints,
                    target_chars=target_chars,
                ),
            },
        ],
        tools=None,
        tool_choice=None,
        stream=True,
        # 中文按字符给足配额，宁可被 max_tokens 截断后由 trim_to_sentence_end 收口，
        # 也不让模型无上限写成整章。
        max_completion_tokens=max(256, target_chars * 3),
    )
    model = str(llm_env.get("STORYFORGE_LLM_MODEL") or "")

    def _generate() -> Iterator[str]:
        yield _sse(
            "start",
            {
                "assistant_session_id": assistant_session.id,
                "tool_call_id": tool_call.id,
                "model": model,
                "target_chars": target_chars,
            },
        )
        raw_parts: list[str] = []
        try:
            for frame in stream_chat_completions(llm_env, request_payload):
                if frame.get("type") == "delta":
                    text = str(frame.get("text") or "")
                    raw_parts.append(text)
                    yield _sse("delta", {"text": text})
                    continue

                final_text = continuation.finalize_continuation(tail, "".join(raw_parts))
                if not final_text:
                    message = "模型这一轮没有写出新内容（可能只是复述了上文）。"
                    update_assistant_tool_call(
                        session,
                        tool_call.id,
                        AssistantToolCallUpdate(status="failed", error_message=message),
                    )
                    yield _sse("error", {"message": message})
                    return

                output_summary: dict[str, Any] = {
                    "final_chars": len(final_text),
                    "raw_chars": len("".join(raw_parts)),
                    "prompt_tokens": frame.get("prompt_tokens"),
                    "completion_tokens": frame.get("completion_tokens"),
                    "token_usage": frame.get("token_usage"),
                    "cost_cny_estimated": frame.get("cost_cny_estimated"),
                    "cost_breakdown": frame.get("cost_breakdown"),
                    "token_usage_source": frame.get("token_usage_source"),
                    "latency_ms": frame.get("latency_ms"),
                }
                if frame.get("reasoning_leak_stripped"):
                    output_summary["reasoning_leak_stripped"] = True
                update_assistant_tool_call(
                    session,
                    tool_call.id,
                    AssistantToolCallUpdate(status="completed", output_summary=output_summary),
                )
                append_assistant_message(
                    session,
                    assistant_session.id,
                    AssistantMessageCreate(
                        role="assistant",
                        content=f"已在 {payload.file_path} 光标处续写约 {len(final_text)} 字，待作者确认。",
                    ),
                )
                # text 是权威结果：流里吐的是原始增量，确定性后处理（掐重复开头、裁到
                # 完整句末）只能在收尾做，前端须以这一帧覆盖累积缓冲。
                yield _sse(
                    "done",
                    {
                        "text": final_text,
                        "model": model,
                        "completion_tokens": frame.get("completion_tokens"),
                        "latency_ms": frame.get("latency_ms"),
                        "assistant_session_id": assistant_session.id,
                    },
                )
                return
        except LLMError as exc:
            update_assistant_tool_call(
                session,
                tool_call.id,
                AssistantToolCallUpdate(status="failed", error_message=str(exc)[:4000]),
            )
            yield _sse("error", {"message": str(exc)})

    return _generate()


def draft_continuation(session: Session, payload: AssistantContinueRequest) -> AssistantDraftResponse:
    """非流式光标处续写，供 agent 工具循环调用（流式 /assistant/continue 供编辑器快捷键）。

    与 stream_continue_prose 共用同一套纯函数（取窗 / prompt / 确定性后处理），只换传输：
    工具循环本身不流式，也不该为了一次工具调用把 SSE 生成器塞进循环。

    返回的 content 只是「要插入的那一段」，不含落点计算——插入由调用方用
    continuation.insert_at_anchor 完成，后端绝不写盘。"""

    llm_env = resolved_llm_env()
    missing = missing_book_generation_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    tail = continuation.manuscript_tail(payload.content, payload.cursor_line)
    target_chars = payload.target_chars or continuation.DEFAULT_TARGET_CHARS
    scene_constraints = _continue_scene_constraints(payload)

    if payload.assistant_session_id is not None:
        assistant_session = get_assistant_session(session, payload.assistant_session_id)
    else:
        assistant_session = create_assistant_session(
            session,
            AssistantSessionCreate(
                title=f"续写 {payload.file_path}"[:160],
                task_type="desktop_continue",
                messages=[
                    AssistantMessageCreate(
                        role="user",
                        content=payload.instruction or f"续写 {payload.file_path}",
                    )
                ],
            ),
        )

    tool_call = create_assistant_tool_call(
        session,
        assistant_session.id,
        AssistantToolCallCreate(
            tool_name="assistant.continue",
            status="running",
            input_summary={
                "file_path": payload.file_path,
                "cursor_line": payload.cursor_line,
                "tail_chars": len(tail),
                "target_chars": target_chars,
                "has_instruction": payload.instruction is not None,
                "has_scene_constraints": scene_constraints is not None,
                "transport": "tool_loop",
            },
        ),
    )

    try:
        result = _call_llm(
            llm_env,
            system_prompt=build_generation_system_prompt(
                continuation.CONTINUE_SYSTEM_PROMPT, payload.project_root
            ),
            user_prompt=continuation.build_continue_prompt(
                tail=tail,
                file_path=payload.file_path,
                instruction=payload.instruction,
                scene_constraints=scene_constraints,
                target_chars=target_chars,
            ),
        )
    except BookGenerationError as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(status="failed", error_message=str(exc)[:4000]),
        )
        raise AssistantReviseError(str(exc)) from exc

    final_text = continuation.finalize_continuation(tail, str(result["content"]))
    if not final_text:
        message = "模型这一轮没有写出新内容（可能只是复述了上文）。"
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(status="failed", error_message=message),
        )
        raise AssistantReviseError(message)

    completion_tokens = result.get("completion_tokens")
    latency_ms = int(result.get("latency_ms", 0) or 0)
    output_summary: dict[str, Any] = {
        "final_chars": len(final_text),
        "prompt_tokens": result.get("prompt_tokens"),
        "completion_tokens": completion_tokens,
        "token_usage": result.get("token_usage"),
        "cost_cny_estimated": result.get("cost_cny_estimated"),
        "cost_breakdown": result.get("cost_breakdown"),
        "token_usage_source": result.get("token_usage_source"),
        "latency_ms": latency_ms,
    }
    if result.get("reasoning_leak_stripped"):
        output_summary["reasoning_leak_stripped"] = True
    update_assistant_tool_call(
        session,
        tool_call.id,
        AssistantToolCallUpdate(status="completed", output_summary=output_summary),
    )

    return AssistantDraftResponse(
        content=final_text,
        summary=f"已在 {payload.file_path} 光标处续写约 {len(final_text)} 字，待作者确认。",
        model=str(llm_env.get("STORYFORGE_LLM_MODEL") or ""),
        latency_ms=latency_ms,
        completion_tokens=completion_tokens if isinstance(completion_tokens, int) else None,
        assistant_session_id=assistant_session.id,
    )


def revise_file_content(session: Session, payload: AssistantReviseRequest) -> AssistantReviseResponse:
    """对当前文件全文按用户指令做一次真实 LLM 修订，落会话与工具调用证据链。

    LLM 未配置或调用失败时明确抛错，不伪造兜底内容。"""

    llm_env = resolved_llm_env()
    missing = missing_book_generation_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    if payload.assistant_session_id is not None:
        assistant_session = get_assistant_session(session, payload.assistant_session_id)
        append_assistant_message(
            session,
            assistant_session.id,
            AssistantMessageCreate(role="user", content=payload.instruction),
        )
    else:
        assistant_session = create_assistant_session(
            session,
            AssistantSessionCreate(
                title=f"修订 {payload.file_path}"[:160],
                task_type="desktop_revise",
                messages=[AssistantMessageCreate(role="user", content=payload.instruction)],
            ),
        )

    tool_call = create_assistant_tool_call(
        session,
        assistant_session.id,
        AssistantToolCallCreate(
            tool_name="assistant.revise",
            status="running",
            input_summary={
                "file_path": payload.file_path,
                "instruction": payload.instruction[:500],
                "content_chars": len(payload.content),
                "context_file_count": len(payload.context_bundle.files) if payload.context_bundle else 0,
            },
        ),
    )

    try:
        result = _call_llm(
            llm_env,
            system_prompt=build_generation_system_prompt(
                _REVISE_SYSTEM_PROMPT, payload.project_root
            ),
            user_prompt=_build_revise_prompt(payload),
        )
    except BookGenerationError as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(status="failed", error_message=str(exc)[:4000]),
        )
        raise AssistantReviseError(str(exc)) from exc

    after = str(result["content"])
    model = str(llm_env.get("STORYFORGE_LLM_MODEL") or "")
    completion_tokens = result.get("completion_tokens")
    latency_ms = int(result.get("latency_ms", 0) or 0)
    summary = f"已按指令修订 {payload.file_path}，修订后约 {len(after)} 字。"

    revise_output_summary: dict[str, Any] = {
        "after_chars": len(after),
        "prompt_tokens": result.get("prompt_tokens"),
        "completion_tokens": completion_tokens,
        "token_usage": result.get("token_usage"),
        "cost_cny_estimated": result.get("cost_cny_estimated"),
        "cost_breakdown": result.get("cost_breakdown"),
        "token_usage_source": result.get("token_usage_source"),
        "latency_ms": latency_ms,
    }
    if result.get("reasoning_leak_stripped"):
        revise_output_summary["reasoning_leak_stripped"] = True
    update_assistant_tool_call(
        session,
        tool_call.id,
        AssistantToolCallUpdate(
            status="completed",
            output_summary=revise_output_summary,
        ),
    )
    append_assistant_message(
        session,
        assistant_session.id,
        AssistantMessageCreate(role="assistant", content=summary),
    )

    return AssistantReviseResponse(
        before=payload.content,
        after=after,
        summary=summary,
        model=model,
        latency_ms=latency_ms,
        completion_tokens=completion_tokens if isinstance(completion_tokens, int) else None,
        assistant_session_id=assistant_session.id,
    )


_DRAFT_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇小说作者。"
    "用户会给你一个新文件的路径与写作指令，请为这个文件起草完整初稿。"
    "严格贴合指令与随附的项目上下文，保持既有人物、设定与大纲的连贯性，不要引入项目里不存在的设定。"
    + craft_prompt_clause(with_examples=True)
    + scene_discipline_clause()
    + "只输出正文内容，不要输出解释、前后缀或代码块标记。"
)


def _build_draft_prompt(payload: AssistantDraftRequest) -> str:
    project_line = f"项目：{payload.project_name}\n" if payload.project_name else ""
    context_block = ""
    if payload.context_bundle and payload.context_bundle.files:
        context_entries = []
        for item in payload.context_bundle.files:
            context_entries.append(
                "\n".join(
                    [
                        f"### {item.relative_path}",
                        f"- 类型：{item.kind}",
                        "<<<CONTEXT",
                        item.excerpt,
                        "CONTEXT>>>",
                    ]
                )
            )
        context_block = (
            "\n项目上下文摘录：这些文件来自同一小说项目，起草时保持大纲、人物、设定与既有正文连贯。\n"
            + "\n\n".join(context_entries)
            + "\n"
        )
    return (
        f"{project_line}新文件路径：{payload.file_path}\n"
        f"{context_block}"
        f"写作指令：{payload.instruction}\n"
        "请输出该文件的完整初稿正文。"
    )


def draft_file_content(session: Session, payload: AssistantDraftRequest) -> AssistantDraftResponse:
    """按指令为一个尚不存在的文件起草初稿，落会话与工具调用证据链。

    LLM 未配置或调用失败时明确抛错，不伪造兜底内容；本函数不写盘，写回由前端补丁确认承担。"""

    llm_env = resolved_llm_env()
    missing = missing_book_generation_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    if payload.assistant_session_id is not None:
        assistant_session = get_assistant_session(session, payload.assistant_session_id)
    else:
        assistant_session = create_assistant_session(
            session,
            AssistantSessionCreate(
                title=f"起草 {payload.file_path}"[:160],
                task_type="desktop_draft",
                messages=[AssistantMessageCreate(role="user", content=payload.instruction)],
            ),
        )

    tool_call = create_assistant_tool_call(
        session,
        assistant_session.id,
        AssistantToolCallCreate(
            tool_name="assistant.draft",
            status="running",
            input_summary={
                "file_path": payload.file_path,
                "instruction": payload.instruction[:500],
                "context_file_count": len(payload.context_bundle.files) if payload.context_bundle else 0,
            },
        ),
    )

    try:
        result = _call_llm(
            llm_env,
            system_prompt=build_generation_system_prompt(
                _DRAFT_SYSTEM_PROMPT, payload.project_root
            ),
            user_prompt=_build_draft_prompt(payload),
        )
    except BookGenerationError as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(status="failed", error_message=str(exc)[:4000]),
        )
        raise AssistantReviseError(str(exc)) from exc

    content = str(result["content"])
    model = str(llm_env.get("STORYFORGE_LLM_MODEL") or "")
    completion_tokens = result.get("completion_tokens")
    latency_ms = int(result.get("latency_ms", 0) or 0)
    summary = f"已起草 {payload.file_path} 初稿，约 {len(content)} 字。"

    draft_output_summary: dict[str, Any] = {
        "content_chars": len(content),
        "prompt_tokens": result.get("prompt_tokens"),
        "completion_tokens": completion_tokens,
        "token_usage": result.get("token_usage"),
        "cost_cny_estimated": result.get("cost_cny_estimated"),
        "cost_breakdown": result.get("cost_breakdown"),
        "token_usage_source": result.get("token_usage_source"),
        "latency_ms": latency_ms,
    }
    if result.get("reasoning_leak_stripped"):
        # 剥离过 think 泄漏的产物可能被吞正文（已实证吞标题），证据链留标记供归因与人工复核。
        draft_output_summary["reasoning_leak_stripped"] = True
    update_assistant_tool_call(
        session,
        tool_call.id,
        AssistantToolCallUpdate(
            status="completed",
            output_summary=draft_output_summary,
        ),
    )

    return AssistantDraftResponse(
        content=content,
        summary=summary,
        model=model,
        latency_ms=latency_ms,
        completion_tokens=completion_tokens if isinstance(completion_tokens, int) else None,
        assistant_session_id=assistant_session.id,
    )


_PROBE_TIMEOUT_CAP_SECONDS = 15.0


def _fetch_provider_models(source: Mapping[str, str | None], *, timeout: float) -> object:
    """对 {BASE_URL}/models 发一次只读探测并返回解析后的 JSON。

    镜像 _call_llm 的 urllib 调用与鉴权（_llm_request_headers），但只读不生成；
    失败按 urllib 异常向上抛，由 probe_provider_health 归类为 unauthorized / unreachable。"""

    url = f"{_required_env(source, 'STORYFORGE_LLM_BASE_URL').rstrip('/')}/models"
    http_request = request.Request(url, headers=_llm_request_headers(source), method="GET")
    with request.urlopen(http_request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def probe_provider_health() -> ProviderHealthResponse:
    """探测后端实际使用的模型服务连通性（resolved_llm_env），用于桌面「测试连接」。

    始终返回结构化诊断（不抛 HTTP 错误），且绝不回显任何凭据。"""

    missing = missing_book_generation_env()
    if missing:
        return ProviderHealthResponse(
            status="misconfigured",
            reachable=False,
            missing_env=missing,
            detail="真实 LLM 未配置，缺少环境变量：" + ", ".join(missing),
        )

    source = resolved_llm_env()
    base_url = _env_value(source, "STORYFORGE_LLM_BASE_URL") or None
    model = _env_value(source, "STORYFORGE_LLM_MODEL") or None
    timeout = min(_optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 300.0), _PROBE_TIMEOUT_CAP_SECONDS)

    started_at = time.monotonic()
    try:
        data = _fetch_provider_models(source, timeout=timeout)
    except error.HTTPError as exc:
        elapsed_ms = max(0, int((time.monotonic() - started_at) * 1000))
        if exc.code in (401, 403):
            return ProviderHealthResponse(
                status="unauthorized",
                reachable=True,
                base_url=base_url,
                model=model,
                latency_ms=elapsed_ms,
                detail=f"鉴权失败：HTTP {exc.code}（检查密钥引用对应的环境变量是否有效）。",
            )
        try:
            error_body = exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:  # noqa: BLE001 - 仅用于诊断，读不出 body 不掩盖原始状态码
            error_body = "<无法读取响应体>"
        return ProviderHealthResponse(
            status="unreachable",
            reachable=False,
            base_url=base_url,
            model=model,
            latency_ms=elapsed_ms,
            detail=f"HTTP {exc.code}：{error_body}",
        )
    except (error.URLError, TimeoutError) as exc:
        elapsed_ms = max(0, int((time.monotonic() - started_at) * 1000))
        reason = getattr(exc, "reason", exc)
        return ProviderHealthResponse(
            status="unreachable",
            reachable=False,
            base_url=base_url,
            model=model,
            latency_ms=elapsed_ms,
            detail=f"连接失败或超时（timeout={timeout}s）：{reason}",
        )
    except BookGenerationPreflightError as exc:
        # 理论上 missing 检查已覆盖；兜底归为未配置，避免 500。
        return ProviderHealthResponse(status="misconfigured", reachable=False, detail=str(exc))

    elapsed_ms = max(0, int((time.monotonic() - started_at) * 1000))
    entries = data["data"] if isinstance(data, dict) and isinstance(data.get("data"), list) else None
    model_count = len(entries) if entries is not None else None
    # 提取模型 id 供桌面「探测模型」下拉选择；封顶 200 避免超大 provider 列表撑爆响应。
    models = (
        [
            str(item["id"])
            for item in entries
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        ][:200]
        if entries is not None
        else []
    )
    return ProviderHealthResponse(
        status="ok",
        reachable=True,
        base_url=base_url,
        model=model,
        latency_ms=elapsed_ms,
        model_count=model_count,
        models=models,
    )
