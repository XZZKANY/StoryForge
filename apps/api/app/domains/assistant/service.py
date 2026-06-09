from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
from app.domains.assistant.schemas import (
    AssistantMessageCreate,
    AssistantSessionCreate,
    AssistantToolCallCreate,
    AssistantToolCallUpdate,
)


class AssistantSessionNotFoundError(RuntimeError):
    """找不到指定 Assistant 会话。"""


class AssistantToolCallNotFoundError(RuntimeError):
    """找不到指定 Assistant 工具调用。"""


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
