from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domains.assistant.models import AssistantMessage, AssistantSession
from app.domains.assistant.schemas import AssistantMessageCreate, AssistantSessionCreate


class AssistantSessionNotFoundError(RuntimeError):
    """找不到指定 Assistant 会话。"""


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
