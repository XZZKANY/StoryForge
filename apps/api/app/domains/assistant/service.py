from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
from app.domains.assistant.schemas import (
    AssistantMessageCreate,
    AssistantReviseRequest,
    AssistantReviseResponse,
    AssistantSessionCreate,
    AssistantToolCallCreate,
    AssistantToolCallUpdate,
)
from app.domains.book_runs.book_generation import (
    BookGenerationError,
    _call_llm,
    missing_book_generation_env,
    resolved_llm_env,
)


class AssistantSessionNotFoundError(RuntimeError):
    """找不到指定 Assistant 会话。"""


class AssistantToolCallNotFoundError(RuntimeError):
    """找不到指定 Assistant 工具调用。"""


class AssistantLlmNotConfiguredError(RuntimeError):
    """真实 LLM 环境变量未配置，无法执行修订。"""

    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__("真实 LLM 未配置，缺少环境变量：" + ", ".join(missing))


class AssistantReviseError(RuntimeError):
    """真实 LLM 修订调用失败，原始报错原样透出。"""


def create_assistant_session(session: Session, payload: AssistantSessionCreate) -> AssistantSession:
    """创建可追溯 Assistant 会话，不接收也不保存敏感凭据。"""

    assistant_session = AssistantSession(
        title=payload.title,
        task_type=payload.task_type,
        blueprint_id=payload.blueprint_id,
        book_run_id=payload.book_run_id,
        artifact_id=payload.artifact_id,
    )
    assistant_session.messages = [
        AssistantMessage(role=message.role, content=message.content) for message in payload.messages
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
    message = AssistantMessage(session_id=assistant_session.id, role=payload.role, content=payload.content)
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
    tool_call = AssistantToolCall(session_id=assistant_session.id, **payload.model_dump())
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
    for key, value in payload.model_dump(exclude_unset=True).items():
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


def get_assistant_session(session: Session, assistant_session_id: int) -> AssistantSession:
    assistant_session = session.scalar(
        select(AssistantSession)
        .options(selectinload(AssistantSession.messages))
        .where(AssistantSession.id == assistant_session_id)
    )
    if assistant_session is None:
        raise AssistantSessionNotFoundError(f"Assistant 会话不存在：{assistant_session_id}。")
    return assistant_session


def list_recent_assistant_sessions(session: Session, *, limit: int = 20) -> list[AssistantSession]:
    """按更新时间倒序读取最近 Assistant 会话。"""

    return list(
        session.scalars(
            select(AssistantSession)
            .options(selectinload(AssistantSession.messages))
            .order_by(AssistantSession.updated_at.desc(), AssistantSession.id.desc())
            .limit(limit)
        )
    )


_REVISE_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇创作编辑。"
    "用户会给你一份正在编辑的文件全文与一条修订指令。"
    "请严格按指令修订，保持原有结构、人物与设定的连贯性。"
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

    update_assistant_tool_call(
        session,
        tool_call.id,
        AssistantToolCallUpdate(
            status="completed",
            output_summary={
                "after_chars": len(after),
                "completion_tokens": completion_tokens,
                "latency_ms": latency_ms,
            },
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
