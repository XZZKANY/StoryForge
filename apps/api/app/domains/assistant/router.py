from __future__ import annotations

from fastapi import APIRouter, status

from app.db.deps import SessionDependency
from app.domains.assistant.schemas import (
    AssistantMessageCreate,
    AssistantMessageRead,
    AssistantReviseRequest,
    AssistantReviseResponse,
    AssistantSessionCreate,
    AssistantSessionRead,
    AssistantToolCallCreate,
    AssistantToolCallRead,
    AssistantToolCallUpdate,
    ProviderHealthResponse,
)
from app.domains.assistant.service import (
    append_assistant_message,
    create_assistant_session,
    create_assistant_tool_call,
    get_assistant_session,
    list_assistant_tool_calls,
    list_recent_assistant_sessions,
    probe_provider_health,
    revise_file_content,
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
def list_assistant_sessions_endpoint(
    session: SessionDependency,
    limit: int = 20,
    project_path: str | None = None,
) -> list[AssistantSessionRead]:
    """读取最近会话，供桌面端会话历史与任务追溯使用；可按项目路径过滤。"""

    bounded_limit = min(max(limit, 1), 50)
    return list_recent_assistant_sessions(session, limit=bounded_limit, project_path=project_path)


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

    return get_assistant_session(session, assistant_session_id)


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

    return append_assistant_message(session, assistant_session_id, payload)


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

    return create_assistant_tool_call(session, assistant_session_id, payload)


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

    return list_assistant_tool_calls(session, assistant_session_id)


@router.post(
    "/revise",
    response_model=AssistantReviseResponse,
    summary="对当前文件按指令做真实 LLM 修订",
)
def revise_file_content_endpoint(
    payload: AssistantReviseRequest,
    session: SessionDependency,
) -> AssistantReviseResponse:
    """桌面 AI 交互区调用：输入文件全文 + 指令，返回真实 LLM 修订后全文。

    LLM 未配置返回 422，调用失败返回 502，错误原样透出，不伪造兜底。"""

    return revise_file_content(session, payload)


@router.get(
    "/provider-health",
    response_model=ProviderHealthResponse,
    summary="探测后端实际使用的模型服务连通性",
)
def provider_health_endpoint() -> ProviderHealthResponse:
    """桌面设置「测试连接」调用：对后端 resolved_llm_env 的 /models 发只读探测。

    始终 200 返回结构化诊断（ok / unauthorized / unreachable / misconfigured），不回显凭据。"""

    return probe_provider_health()


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

    return update_assistant_tool_call(session, tool_call_id, payload)
