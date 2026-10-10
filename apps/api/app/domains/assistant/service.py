from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.common.author_edit_policy import AuthorEditPolicyError
from app.common.author_voice import build_generation_system_prompt, edit_policy_from_generation_prompt
from app.common.craft import (
    craft_prompt_clause,
    scene_discipline_clause,
)
from app.common.exceptions import ConflictError, DomainError, NotFoundError
from app.common.generation_delivery import record_generation_delivery
from app.common.generation_sources import GenerationSourceCapture
from app.common.llm_client import (
    LLMError,
    build_chat_payload,
    error_usage_summary,
    fetch_provider_models,
    stream_chat_completions,
)

# LLM 传输 / 配置一律直连 app.common 真身：经 book_generation 拿只是 facade 转发，
# 会让 live 的 assistant 看起来依赖 backing 的 book_runs（实际不依赖）。
from app.common.llm_client import (
    call_llm as _call_llm,
)
from app.common.llm_client import (
    call_llm_streamed as _call_llm_streamed,
)
from app.common.llm_control import LLMRunInterrupted
from app.common.llm_env import missing_llm_env, resolved_llm_env
from app.common.manuscript import previous_chapter_tail
from app.common.performance import measure_stage, measured
from app.common.performance_logging import observe_run
from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.assistant import continuation, provider_health
from app.domains.assistant.continue_context import admitted_continue_context
from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
from app.domains.assistant.revision import (
    REVISION_SYSTEM_PROMPT,
    RevisionContextFile,
    RevisionInput,
    RevisionQualityRejected,
    build_revision_prompt,
    revise_text,
)
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
from app.domains.assistant.session_scope import assert_session_project_matches
from app.domains.assistant.writing_context import PreparedWritingContext, admit_writing_request
from app.platform.ai_sdk.contracts import TokenUsage


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

    def __init__(self, message: str, *, usage: TokenUsage | None = None) -> None:
        super().__init__(message)
        self.usage = usage


class AssistantReviseQualityGateError(ConflictError, RuntimeError):
    """模型候选相对原文退步，不能进入行内 diff。"""

    def __init__(self, reasons: tuple[str, ...]) -> None:
        self.reasons = reasons
        super().__init__("润色候选未通过质量门禁：" + ", ".join(reasons))


@measured("store.session")
def create_assistant_session(session: Session, payload: AssistantSessionCreate) -> AssistantSession:
    """创建可追溯 Assistant 会话，不接收也不保存敏感凭据。"""

    assistant_session = AssistantSession(
        title=redact_sensitive_text(payload.title),
        task_type=payload.task_type,
        project_path=payload.project_path,
    )
    assistant_session.messages = [
        AssistantMessage(role=message.role, content=redact_sensitive_text(message.content)) for message in payload.messages
    ]
    session.add(assistant_session)
    session.commit()
    return get_assistant_session(session, assistant_session.id)


@measured("store.message")
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


@measured("store.tool_create")
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


@measured("store.tool_update")
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


# Prompt Lab 和既有调用方的兼容入口；模板事实源在 revision 能力内。
_REVISE_SYSTEM_PROMPT = REVISION_SYSTEM_PROMPT


def _revision_input(
    payload: AssistantReviseRequest, scene_constraints: str | None, *, system_prompt: str,
    author_instruction: str | None = None,
) -> RevisionInput:
    return RevisionInput(
        file_path=payload.file_path,
        content=payload.content,
        instruction=payload.instruction,
        system_prompt=system_prompt,
        project_name=payload.project_name,
        context_files=(
            tuple(RevisionContextFile(item.relative_path, item.kind, item.excerpt) for item in payload.context_bundle.files)
            if payload.context_bundle else ()
        ),
        scene_constraints=scene_constraints,
        quality_gate=payload.quality_gate,
        edit_policy=edit_policy_from_generation_prompt(
            payload.content,
            instruction=payload.instruction if author_instruction is None else author_instruction,
            system_prompt=system_prompt,
        ),
    )


def _build_revise_prompt(payload: AssistantReviseRequest, scene_constraints: str | None) -> str:
    # 兼容纯 user prompt 渲染；这里不能读取作者配置或项目文件。
    return build_revision_prompt(_revision_input(payload, scene_constraints, system_prompt=""))


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
    missing = missing_llm_env()
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
    except LLMRunInterrupted as exc:
        update_assistant_tool_call(
            session, tool_call.id,
            AssistantToolCallUpdate(status="paused", output_summary={
                "execution_state": "unknown", "interruption_reason": exc.reason,
                **error_usage_summary(exc, source=llm_env),
            }),
        )
        raise
    except LLMError as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="failed", error_message=str(exc)[:4000],
                output_summary=error_usage_summary(exc, source=llm_env),
            ),
        )
        raise AssistantReviseError(str(exc), usage=exc.usage) from exc

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


def _scene_constraints(project_root: str | None, file_path: str | None) -> str | None:
    """canon 硬约束 + 活跃伏笔 + 本章伏笔计划；四条产字路径共用。

    canon 住在 `domains/agent_runs`，而 `app/common` 不得 import domains、assistant 也不得
    顶层 import agent_runs（file.create 反向依赖本模块会成环），所以 canon 进不了
    `build_generation_system_prompt` 那个统一组装点——只能每条产字路径各自延迟导入一次。
    """

    if not project_root:
        return None
    from app.domains.agent_runs import canon_context

    try:
        return canon_context.build_scene_constraint_block(project_root, file_path)
    except Exception:  # noqa: BLE001 - canon 缺失或损坏绝不能挡住作者继续写
        return None


def _continue_scene_constraints(payload: AssistantContinueRequest) -> str | None:
    return _scene_constraints(payload.project_root, payload.file_path)


def _continue_previous_chapter(payload: AssistantContinueRequest) -> tuple[str, str] | None:
    if not payload.project_root:
        return None
    return previous_chapter_tail(payload.project_root, payload.file_path)


def _record_generation_sources(session, tool_call, sources, system_prompt, user_prompt):
    try:
        evidence = sources.manifest(system_prompt, user_prompt)
    except ValueError as exc:
        message = "生成来源证据超出预算，未调用模型，请缩小上下文。"
        update_assistant_tool_call(
            session, tool_call.id, AssistantToolCallUpdate(status="failed", error_message=message)
        )
        raise AssistantReviseError(message) from exc
    summary = {**(tool_call.input_summary or {}), "generation_sources": evidence}
    return update_assistant_tool_call(session, tool_call.id, AssistantToolCallUpdate(input_summary=summary))


def stream_continue_prose(session: Session, payload: AssistantContinueRequest) -> Iterator[str]:
    """光标处续写：同步做前置校验与证据链落库，返回逐块吐字的 SSE 生成器。

    外层刻意不是生成器——LLM 未配置必须在 StreamingResponse 建立之前抛成 422，否则错误
    只能裹在流里以 200 送出，前端拿不到状态码。
    """

    llm_env = resolved_llm_env()
    missing = missing_llm_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    anchor_line = continuation.resolve_anchor_line(payload.content, payload.cursor_line)
    tail = continuation.manuscript_tail(payload.content, anchor_line)
    suffix = continuation.manuscript_suffix(payload.content, anchor_line)
    sources = GenerationSourceCapture(payload.project_root, current_file=payload.file_path)
    with sources.collecting():
        context_bundle = admitted_continue_context(payload)
    target_chars = payload.target_chars or continuation.DEFAULT_TARGET_CHARS
    sources.continuation(payload.content, anchor_line, tail, suffix, suffix_limit=continuation.SUFFIX_MAX_CHARS)
    with sources.collecting():
        scene_constraints = _continue_scene_constraints(payload)
        previous_chapter = _continue_previous_chapter(payload)
    instruction_label = payload.instruction or f"续写 {payload.file_path}"

    if payload.assistant_session_id is not None:
        assistant_session = get_assistant_session(session, payload.assistant_session_id)
        assert_session_project_matches(assistant_session, payload.project_root)
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
                project_path=payload.project_root,
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
                "suffix_chars": min(len(suffix), continuation.SUFFIX_MAX_CHARS),
                "suffix_truncated": len(suffix) > continuation.SUFFIX_MAX_CHARS,
                "context_file_count": len(context_bundle.files) if context_bundle else 0,
                "target_chars": target_chars,
                "has_instruction": payload.instruction is not None,
                "has_scene_constraints": scene_constraints is not None,
                "previous_chapter": previous_chapter[0] if previous_chapter else None,
            },
        ),
    )

    with sources.collecting():
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
                        suffix=suffix,
                        context_bundle=context_bundle,
                        instruction=payload.instruction,
                        scene_constraints=scene_constraints,
                        previous_chapter=previous_chapter,
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
    _record_generation_sources(
        session,
        tool_call,
        sources,
        request_payload["messages"][0]["content"],
        request_payload["messages"][1]["content"],
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
        except LLMRunInterrupted as exc:
            update_assistant_tool_call(
                session,
                tool_call.id,
                AssistantToolCallUpdate(
                    status="paused",
                    output_summary={
                        "execution_state": "unknown",
                        "interruption_reason": exc.reason,
                        **error_usage_summary(exc, source=llm_env),
                    },
                ),
            )
            raise
        except LLMError as exc:
            update_assistant_tool_call(
                session,
                tool_call.id,
                AssistantToolCallUpdate(
                    status="failed",
                    error_message=str(exc)[:4000],
                    output_summary=error_usage_summary(exc, source=llm_env),
                ),
            )
            yield _sse("error", {"message": str(exc)})

    return _generate()


def draft_continuation(
    session: Session, payload: AssistantContinueRequest, *, prepared_context: PreparedWritingContext | None = None
) -> AssistantDraftResponse:
    """非流式光标处续写，供 agent 工具循环调用（流式 /assistant/continue 供编辑器快捷键）。

    与 stream_continue_prose 共用同一套纯函数（取窗 / prompt / 确定性后处理），只换传输：
    工具循环本身不流式，也不该为了一次工具调用把 SSE 生成器塞进循环。

    返回的 content 只是「要插入的那一段」，不含落点计算——插入由调用方用
    continuation.insert_at_anchor 完成，后端绝不写盘。"""

    llm_env = resolved_llm_env()
    missing = missing_llm_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    sources = GenerationSourceCapture(payload.project_root, current_file=payload.file_path)
    with sources.collecting():
        payload = admit_writing_request(payload, intent="prose.continue", prepared_context=prepared_context)
    anchor_line = continuation.resolve_anchor_line(payload.content, payload.cursor_line)
    tail = continuation.manuscript_tail(payload.content, anchor_line)
    suffix = continuation.manuscript_suffix(payload.content, anchor_line)
    target_chars = payload.target_chars or continuation.DEFAULT_TARGET_CHARS
    sources.continuation(payload.content, anchor_line, tail, suffix, suffix_limit=continuation.SUFFIX_MAX_CHARS)
    with sources.collecting():
        scene_constraints = _continue_scene_constraints(payload)
        previous_chapter = _continue_previous_chapter(payload)

    if payload.assistant_session_id is not None:
        assistant_session = get_assistant_session(session, payload.assistant_session_id)
        assert_session_project_matches(assistant_session, payload.project_root)
    else:
        assistant_session = create_assistant_session(
            session,
            AssistantSessionCreate(
                title=f"续写 {payload.file_path}"[:160],
                task_type="desktop_continue",
                project_path=payload.project_root,
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
                "suffix_chars": min(len(suffix), continuation.SUFFIX_MAX_CHARS),
                "suffix_truncated": len(suffix) > continuation.SUFFIX_MAX_CHARS,
                "context_file_count": len(payload.context_bundle.files) if payload.context_bundle else 0,
                "target_chars": target_chars,
                "has_instruction": payload.instruction is not None,
                "has_scene_constraints": scene_constraints is not None,
                "previous_chapter": previous_chapter[0] if previous_chapter else None,
                "transport": "tool_loop",
            },
        ),
    )

    try:
        with sources.collecting():
            system_prompt = build_generation_system_prompt(continuation.CONTINUE_SYSTEM_PROMPT, payload.project_root)
            user_prompt = continuation.build_continue_prompt(
                tail=tail,
                file_path=payload.file_path,
                suffix=suffix,
                context_bundle=payload.context_bundle,
                instruction=payload.instruction,
                scene_constraints=scene_constraints,
                previous_chapter=previous_chapter,
                target_chars=target_chars,
            )
        stored = _record_generation_sources(session, tool_call, sources, system_prompt, user_prompt)
        try:
            record_generation_delivery(stored.id, stored.input_summary["generation_sources"])
        except Exception as exc:  # noqa: BLE001 - delivery acknowledgement must fail closed before provider
            session.rollback()
            message = "生成送达关联未能持久化，未调用模型。"
            update_assistant_tool_call(session, tool_call.id, AssistantToolCallUpdate(status="failed", error_message=message))
            raise AssistantReviseError(message) from exc
        result = _call_llm_streamed(llm_env, system_prompt=system_prompt, user_prompt=user_prompt)
    except LLMRunInterrupted as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="paused",
                output_summary={
                    "execution_state": "unknown",
                    "interruption_reason": exc.reason,
                    **error_usage_summary(exc, source=llm_env),
                },
            ),
        )
        raise
    except LLMError as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="failed",
                error_message=str(exc)[:4000],
                output_summary=error_usage_summary(exc, source=llm_env),
            ),
        )
        raise AssistantReviseError(str(exc), usage=exc.usage) from exc

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


@observe_run("revision.use_case")
def revise_file_content(
    session: Session,
    payload: AssistantReviseRequest,
    *,
    author_instruction: str | None = None,
    prepared_context: PreparedWritingContext | None = None,
) -> AssistantReviseResponse:
    """对当前文件全文按用户指令做一次真实 LLM 修订，落会话与工具调用证据链。

    LLM 未配置或调用失败时明确抛错，不伪造兜底内容。"""

    llm_env = resolved_llm_env()
    missing = missing_llm_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    with measure_stage("revision.constraints"):
        sources = GenerationSourceCapture(payload.project_root)
        with sources.collecting():
            payload = admit_writing_request(payload, intent="file.revise", prepared_context=prepared_context)
            scene_constraints = _scene_constraints(payload.project_root, payload.file_path)

    if payload.assistant_session_id is not None:
        assistant_session = get_assistant_session(session, payload.assistant_session_id)
        assert_session_project_matches(assistant_session, payload.project_root)
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
                project_path=payload.project_root,
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
                "has_scene_constraints": scene_constraints is not None,
            },
        ),
    )

    def generate(*, system_prompt: str, user_prompt: str) -> Mapping[str, object]:
        # 请求内绑定配置，调用时解析现有 streamed seam，保留传输与 monkeypatch 行为。
        _record_generation_sources(session, tool_call, sources, system_prompt, user_prompt)
        return _call_llm_streamed(llm_env, system_prompt=system_prompt, user_prompt=user_prompt)

    try:
        with measure_stage("revision.system_prompt"), sources.collecting():
            system_prompt = build_generation_system_prompt(_REVISE_SYSTEM_PROMPT, payload.project_root)
        revision = revise_text(
            _revision_input(
                payload,
                scene_constraints,
                system_prompt=system_prompt,
                author_instruction=author_instruction,
            ),
            generate=generate,
        )
    except LLMRunInterrupted as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="paused",
                output_summary={
                    "execution_state": "unknown",
                    "interruption_reason": exc.reason,
                    **error_usage_summary(exc, source=llm_env),
                },
            ),
        )
        raise
    except LLMError as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="failed",
                error_message=str(exc)[:4000],
                output_summary=error_usage_summary(exc, source=llm_env),
            ),
        )
        raise AssistantReviseError(str(exc), usage=exc.usage) from exc
    except AuthorEditPolicyError as exc:
        message = "作者编辑要求无效，请重新指定需要逐字保留的片段。"
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(status="failed", error_message=message),
        )
        raise AssistantReviseError(message) from exc
    except RevisionQualityRejected as exc:
        quality_gate = exc.gate
        error = AssistantReviseQualityGateError(quality_gate.reasons)
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="failed",
                output_summary={
                    "quality_gate": {
                        "version": quality_gate.gate_version,
                        "passed": False,
                        "reasons": list(quality_gate.reasons),
                        "metrics": dict(quality_gate.metrics),
                    }
                },
                error_message=str(error),
            ),
        )
        raise error from exc
    after = revision.after
    quality_gate = revision.quality_gate
    result = revision.telemetry
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
    if quality_gate is not None:
        revise_output_summary["quality_gate"] = {
            "version": quality_gate.gate_version,
            "passed": True,
            "reasons": [],
            "advisories": list(quality_gate.advisories),
            "metrics": dict(quality_gate.metrics),
        }
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
    + craft_prompt_clause()
    + scene_discipline_clause()
    + "只输出正文内容，不要输出解释、前后缀或代码块标记。"
)


def _build_draft_prompt(
    payload: AssistantDraftRequest,
    scene_constraints: str | None,
    previous_chapter: tuple[str, str] | None,
) -> str:
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
    constraint_block = f"\n{scene_constraints}\n" if scene_constraints else ""
    previous_block = (
        f"\n上一章（{previous_chapter[0]}）的结尾：\n<<<PREVIOUS\n{previous_chapter[1]}\nPREVIOUS>>>\n"
        if previous_chapter
        else ""
    )
    return (
        f"{project_line}新文件路径：{payload.file_path}\n"
        f"{context_block}"
        f"{previous_block}"
        f"{constraint_block}"
        f"写作指令：{payload.instruction}\n"
        "请输出该文件的完整初稿正文。"
    )


def draft_file_content(
    session: Session, payload: AssistantDraftRequest, *, prepared_context: PreparedWritingContext | None = None
) -> AssistantDraftResponse:
    """按指令为一个尚不存在的文件起草初稿，落会话与工具调用证据链。

    LLM 未配置或调用失败时明确抛错，不伪造兜底内容；本函数不写盘，写回由前端补丁确认承担。"""

    llm_env = resolved_llm_env()
    missing = missing_llm_env()
    if missing:
        raise AssistantLlmNotConfiguredError(missing)

    sources = GenerationSourceCapture(payload.project_root)
    with sources.collecting():
        payload = admit_writing_request(payload, intent="file.create", prepared_context=prepared_context)
        scene_constraints = _scene_constraints(payload.project_root, payload.file_path)
        previous_chapter = previous_chapter_tail(payload.project_root, payload.file_path)

    if payload.assistant_session_id is not None:
        assistant_session = get_assistant_session(session, payload.assistant_session_id)
        assert_session_project_matches(assistant_session, payload.project_root)
    else:
        assistant_session = create_assistant_session(
            session,
            AssistantSessionCreate(
                title=f"起草 {payload.file_path}"[:160],
                task_type="desktop_draft",
                project_path=payload.project_root,
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
                "has_scene_constraints": scene_constraints is not None,
                "previous_chapter": previous_chapter[0] if previous_chapter else None,
            },
        ),
    )

    try:
        with sources.collecting():
            system_prompt = build_generation_system_prompt(_DRAFT_SYSTEM_PROMPT, payload.project_root)
            user_prompt = _build_draft_prompt(payload, scene_constraints, previous_chapter)
        _record_generation_sources(session, tool_call, sources, system_prompt, user_prompt)
        result = _call_llm_streamed(llm_env, system_prompt=system_prompt, user_prompt=user_prompt)
    except LLMRunInterrupted as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="paused",
                output_summary={
                    "execution_state": "unknown",
                    "interruption_reason": exc.reason,
                    **error_usage_summary(exc, source=llm_env),
                },
            ),
        )
        raise
    except LLMError as exc:
        update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(
                status="failed",
                error_message=str(exc)[:4000],
                output_summary=error_usage_summary(exc, source=llm_env),
            ),
        )
        raise AssistantReviseError(str(exc), usage=exc.usage) from exc

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


_PROBE_TIMEOUT_CAP_SECONDS = provider_health.PROBE_TIMEOUT_CAP_SECONDS
_fetch_provider_models = fetch_provider_models


def probe_provider_health() -> ProviderHealthResponse:
    """桌面诊断 facade；保留配置和只读 transport 注入 seam。"""
    return _probe_provider_health()


def _probe_provider_health() -> ProviderHealthResponse:
    return provider_health.probe_provider_health(
        resolve_source=resolved_llm_env,
        missing_env=missing_llm_env,
        fetch_models=_fetch_provider_models,
    )
