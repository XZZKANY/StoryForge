from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.assistant.schemas import (
    AssistantMessageCreate,
    AssistantMessageRead,
    AssistantSessionCreate,
    AssistantSessionRead,
    AssistantToolCallCreate,
    AssistantToolCallRead,
    AssistantToolCallUpdate,
)
from app.domains.assistant.service import (
    AssistantSessionNotFoundError,
    AssistantToolCallNotFoundError,
    append_assistant_message,
    create_assistant_session,
    create_assistant_tool_call,
    get_assistant_session,
    list_assistant_tool_calls,
    list_recent_assistant_sessions,
    update_assistant_tool_call,
)

router = APIRouter(prefix="/api/assistant", tags=["Assistant 会话"])


@router.post(
    "/sessions",
    response_model=AssistantSessionRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建 Assistant 会话",
)
def create_assistant_session_endpoint(
    payload: AssistantSessionCreate,
    session: SessionDependency,
) -> AssistantSessionRead:
    """创建 Assistant 会话，保存消息和业务引用，不保存敏感凭据。"""

    return create_assistant_session(session, payload)


@router.get(
    "/sessions",
    response_model=list[AssistantSessionRead],
    summary="读取最近 Assistant 会话",
)
def list_assistant_sessions_endpoint(session: SessionDependency, limit: int = 20) -> list[AssistantSessionRead]:
    """读取最近会话，供首页最近记录和任务追溯使用。"""

    bounded_limit = min(max(limit, 1), 50)
    return list_recent_assistant_sessions(session, limit=bounded_limit)


@router.get(
    "/sessions/{assistant_session_id}",
    response_model=AssistantSessionRead,
    summary="读取 Assistant 会话详情",
)
def get_assistant_session_endpoint(
    assistant_session_id: int,
    session: SessionDependency,
) -> AssistantSessionRead:
    """读取指定会话的完整消息历史，供最近记录跳回 Assistant 时恢复上下文。"""

    try:
        return get_assistant_session(session, assistant_session_id)
    except AssistantSessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/sessions/{assistant_session_id}/messages",
    response_model=AssistantMessageRead,
    status_code=status.HTTP_201_CREATED,
    summary="追加 Assistant 消息",
)
def append_assistant_message_endpoint(
    assistant_session_id: int,
    payload: AssistantMessageCreate,
    session: SessionDependency,
) -> AssistantMessageRead:
    """向指定会话追加消息。"""

    try:
        return append_assistant_message(session, assistant_session_id, payload)
    except AssistantSessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/sessions/{assistant_session_id}/tool-calls",
    response_model=AssistantToolCallRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建 Assistant 工具调用事实",
)
def create_assistant_tool_call_endpoint(
    assistant_session_id: int,
    payload: AssistantToolCallCreate,
    session: SessionDependency,
) -> AssistantToolCallRead:
    """为指定会话追加工具调用事实，用于重放工具树状态。"""

    try:
        return create_assistant_tool_call(session, assistant_session_id, payload)
    except AssistantSessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/sessions/{assistant_session_id}/tool-calls",
    response_model=list[AssistantToolCallRead],
    summary="读取 Assistant 会话工具调用事实",
)
def list_assistant_tool_calls_endpoint(
    assistant_session_id: int,
    session: SessionDependency,
) -> list[AssistantToolCallRead]:
    """按写入顺序读取会话 tool call，供前端工具树优先消费。"""

    try:
        return list_assistant_tool_calls(session, assistant_session_id)
    except AssistantSessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch(
    "/tool-calls/{tool_call_id}",
    response_model=AssistantToolCallRead,
    summary="更新 Assistant 工具调用事实",
)
def update_assistant_tool_call_endpoint(
    tool_call_id: int,
    payload: AssistantToolCallUpdate,
    session: SessionDependency,
) -> AssistantToolCallRead:
    """更新工具调用状态、摘要和关联对象，不接收敏感凭据。"""

    try:
        return update_assistant_tool_call(session, tool_call_id, payload)
    except AssistantToolCallNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
