from __future__ import annotations

import json
import time
from collections.abc import Mapping
from typing import Any
from urllib import error, request

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.common.exceptions import DomainError, NotFoundError
from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
from app.domains.assistant.schemas import (
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
    _call_llm,
    _env_value,
    _llm_request_headers,
    _optional_float,
    _required_env,
    missing_book_generation_env,
    resolved_llm_env,
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
    "只输出修订后的完整正文，不要输出解释、前后缀或代码块标记。"
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
                "cost_cny_estimated": result.get("cost_cny_estimated"),
            },
        ),
    )
    return {
        "reply": reply,
        "model": model,
        "completion_tokens": result.get("completion_tokens"),
        "latency_ms": int(result.get("latency_ms", 0) or 0),
    }


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
            system_prompt=_REVISE_SYSTEM_PROMPT,
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
        "cost_cny_estimated": result.get("cost_cny_estimated"),
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
    "只输出正文内容，不要输出解释、前后缀或代码块标记。"
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
            system_prompt=_DRAFT_SYSTEM_PROMPT,
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
        "cost_cny_estimated": result.get("cost_cny_estimated"),
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
    model_count = (
        len(data["data"]) if isinstance(data, dict) and isinstance(data.get("data"), list) else None
    )
    return ProviderHealthResponse(
        status="ok",
        reachable=True,
        base_url=base_url,
        model=model,
        latency_ms=elapsed_ms,
        model_count=model_count,
    )
