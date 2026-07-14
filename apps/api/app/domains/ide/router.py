from __future__ import annotations

import asyncio
import json
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import sessionmaker

from app.db.deps import SessionDependency
from app.domains.agent_runs.event_types import CONTROL_MESSAGE_TYPES
from app.domains.agent_runs.service import (
    AgentRuntimeError,
    AgentRuntimeUserMessageError,
    handle_agent_control_message,
    run_agent_user_message,
    websocket_control_event,
    websocket_stream_events_from_agent_event,
)
from app.domains.book_runs.book_generation import (
    BookGenerationError,
    missing_book_generation_env,
    resolved_llm_env,
)
from app.domains.book_runs.service import get_book_run
from app.domains.ide.cross_chapter_consistency import check_cross_chapter_consistency
from app.domains.ide.schemas import (
    IdeArtifactPreview,
    IdeCommandRequest,
    IdeCommandResult,
    IdeContextSnapshot,
    IdeCrossChapterRequest,
    IdeCrossChapterResult,
    IdeDiagnostic,
    IdeSceneRead,
    IdeStoryMemoryQuery,
    IdeStoryMemoryQueryResult,
    IdeWorkspaceTree,
)
from app.domains.ide.service import (
    build_run_events,
    encode_sse_event,
    execute_ide_command_by_id,
    get_artifact_preview,
    get_context_snapshot,
    get_workspace_tree,
    list_diagnostics_for_scene,
    query_story_memory,
    read_ide_scene,
)

router = APIRouter(prefix="/api/ide", tags=["IDE 工作台"])

_STREAM_EVENT = "stream_event"
_STREAM_RESULT = "result"
_STREAM_ERROR = "error"


async def _agent_user_message_payloads(session, *, session_id: str, message: dict[str, Any]):
    """跑同步 AgentRuntime（off-loop），按事件顺序产出前端帧 payload，终态帧（result/error）后收尾。

    本地 SSE 流以该 pump 为唯一运行入口；帧形状由 event_encoders / ws_messages 管理。
    """

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    session_bind = session.get_bind()
    thread_session_factory = sessionmaker(bind=session_bind, autoflush=False, autocommit=False, expire_on_commit=False)

    def enqueue(item: dict[str, Any]) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, item)
        except RuntimeError:
            return

    def on_event(event) -> None:  # noqa: ANN001 - callback receives ORM AgentRunEvent from runtime thread
        for payload in websocket_stream_events_from_agent_event(event):
            enqueue({"kind": _STREAM_EVENT, "payload": payload})

    def run_in_thread() -> None:
        with thread_session_factory() as thread_session:
            try:
                runtime_result = run_agent_user_message(
                    thread_session,
                    agent_session_id=session_id,
                    message=message,
                    on_event=on_event,
                )
            except AgentRuntimeError as exc:
                payload: dict[str, Any] = {"type": "error", "session_id": session_id, "detail": str(exc)}
                if isinstance(exc, AgentRuntimeUserMessageError):
                    payload["run_id"] = exc.run.public_id
                enqueue({"kind": _STREAM_ERROR, "payload": payload})
                return
            except Exception as exc:  # noqa: BLE001 - worker must always release the receiver loop
                enqueue({"kind": _STREAM_ERROR, "payload": {"type": "error", "session_id": session_id, "detail": str(exc)}})
                return
            enqueue({"kind": _STREAM_RESULT, "payload": runtime_result.result})

    worker = asyncio.create_task(asyncio.to_thread(run_in_thread))
    try:
        while True:
            item = await queue.get()
            kind = item.get("kind")
            payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
            yield payload
            if kind in (_STREAM_RESULT, _STREAM_ERROR):
                break
    finally:
        await worker


def _sse_data_frame(payload: dict[str, Any]) -> str:
    """把前端帧 payload 编成 SSE data 帧；前端按 payload.type 判别式解码。"""

    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _agent_user_message_sse(session, *, session_id: str, message: dict[str, Any]):
    async for payload in _agent_user_message_payloads(session, session_id=session_id, message=message):
        yield _sse_data_frame(payload)


@router.get(
    "/workspace-tree",
    response_model=IdeWorkspaceTree,
    summary="读取 IDE 工作区树",
)
def read_workspace_tree(session: SessionDependency) -> IdeWorkspaceTree:
    """返回 IDE Explorer 初始渲染所需的作品与章节树。"""

    return get_workspace_tree(session)


@router.get(
    "/diagnostics",
    response_model=list[IdeDiagnostic],
    summary="读取 IDE 诊断列表",
)
def list_diagnostics(
    session: SessionDependency,
    scene_id: Annotated[int, Query(gt=0)],
) -> list[IdeDiagnostic]:
    """返回指定场景的开放诊断问题。"""

    return list_diagnostics_for_scene(session, scene_id)


@router.get(
    "/scenes/{scene_id}",
    response_model=IdeSceneRead,
    summary="读取 IDE 场景正文",
)
def read_scene_for_ide(session: SessionDependency, scene_id: int) -> IdeSceneRead:
    """返回 JudgeRepairWorkbench 渲染和修复命令需要的场景正文。"""

    scene = read_ide_scene(session, scene_id)
    if scene is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="场景不存在，无法读取 IDE 场景正文。",
        )
    return scene


@router.get(
    "/context-snapshot/{compiled_context_id}",
    response_model=IdeContextSnapshot,
    summary="读取 IDE 上下文快照",
)
def read_context_snapshot(session: SessionDependency, compiled_context_id: str) -> IdeContextSnapshot:
    """返回 Context Inspector 渲染所需的上下文编译记录。"""

    snapshot = get_context_snapshot(session, compiled_context_id)
    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"snapshot evicted at unknown: {compiled_context_id}",
        )
    return snapshot


@router.post(
    "/story-memory/query",
    response_model=IdeStoryMemoryQueryResult,
    summary="查询 IDE Story Memory",
)
def query_story_memory_endpoint(session: SessionDependency, payload: IdeStoryMemoryQuery) -> IdeStoryMemoryQueryResult:
    """返回 Story Memory Explorer 所需的长效记忆和冲突队列。"""

    return query_story_memory(session, payload)


@router.post(
    "/review/cross-chapter",
    response_model=IdeCrossChapterResult,
    summary="跨章一致性检查",
)
def cross_chapter_consistency_endpoint(payload: IdeCrossChapterRequest) -> IdeCrossChapterResult:
    """对若干完整章节做跨章一致性审校,返回带原文出处的硬冲突(时间线/称谓/设定/角色离场/伏笔)。"""

    missing = missing_book_generation_env()
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="真实 LLM 未配置：" + ", ".join(missing),
        )
    chapters = [{"name": item.name, "content": item.content} for item in payload.chapters]
    try:
        result = check_cross_chapter_consistency(resolved_llm_env(), chapters, focus=payload.focus)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except BookGenerationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"跨章一致性 LLM 调用失败：{exc}",
        ) from exc
    return IdeCrossChapterResult.model_validate(result)


@router.get(
    "/artifacts/{artifact_id}/preview",
    response_model=IdeArtifactPreview,
    summary="读取 IDE 制品预览",
)
def read_artifact_preview(
    session: SessionDependency,
    artifact_id: int,
    workspace_id: Annotated[int, Query(gt=0)],
) -> IdeArtifactPreview:
    """返回 Artifact Viewer 所需的预览、下载摘要、版本和追溯链。"""

    return get_artifact_preview(session, artifact_id, workspace_id=workspace_id)


@router.get(
    "/runs/{book_run_id}/events",
    summary="读取 IDE BookRun 事件流",
)
def stream_run_events(session: SessionDependency, book_run_id: int) -> StreamingResponse:
    """返回 BookRun 当前状态投影生成的 SSE 快照事件。"""

    book_run = get_book_run(session, book_run_id)

    def event_stream():
        for event in build_run_events(book_run):
            yield encode_sse_event(event.event, event.data)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post(
    "/commands/{command_id}",
    response_model=IdeCommandResult,
    summary="执行 IDE 命令",
)
def execute_ide_command(
    session: SessionDependency, command_id: str, payload: IdeCommandRequest | None = None
) -> IdeCommandResult:
    """执行已注册 IDE 命令，所有写操作都返回审计追踪 ID。"""

    return execute_ide_command_by_id(command_id, (payload or IdeCommandRequest()).args, session)


class AgentUserMessageStreamRequest(BaseModel):
    """本地 SSE 直播入口的用户消息体。"""

    user_message: str | None = None
    run_id: str | None = None
    assistant_session_id: int | None = None
    intent: str | None = None
    permission_profile: str | None = None
    args: dict[str, Any] = Field(default_factory=dict)


class AgentControlRequest(BaseModel):
    """Agent 控制消息体（暂停 / 恢复 / 停止 / 权限批准 / 拒绝 / 从 checkpoint 重试）。"""

    type: str
    run_id: str
    payload: dict[str, Any] = Field(default_factory=dict)


@router.post("/agent/sessions/{session_id}/stream", summary="Agent 用户消息本地 SSE 流")
async def stream_agent_user_message_endpoint(
    session_id: str,
    request: AgentUserMessageStreamRequest,
    session: SessionDependency,
) -> StreamingResponse:
    """本地 SSE 直播工具循环：替代 WS user_message 流；控制走 /agent/sessions/{id}/control。"""

    message: dict[str, Any] = {
        "type": "user_message",
        "stream": True,
        "run_id": request.run_id,
        "user_message": request.user_message,
        "assistant_session_id": request.assistant_session_id,
        "intent": request.intent,
        "permission_profile": request.permission_profile,
        "args": request.args or {},
    }
    return StreamingResponse(
        _agent_user_message_sse(session, session_id=session_id, message=message),
        media_type="text/event-stream",
    )


@router.post("/agent/sessions/{session_id}/control", summary="Agent 控制消息")
def post_agent_control_endpoint(
    session_id: str,
    request: AgentControlRequest,
    session: SessionDependency,
) -> dict[str, Any]:
    """替代 WS 控制通道：领域错误按 {type:"error"} 帧以 200 返回（前端 resolve 而非 throw）。"""

    if request.type not in CONTROL_MESSAGE_TYPES:
        return {"type": "error", "session_id": session_id, "detail": f"不支持的控制消息：{request.type}。"}
    run_id = (request.run_id or "").strip()
    if not run_id:
        return {"type": "error", "session_id": session_id, "detail": f"{request.type} 消息缺少 run_id。"}
    payload = request.payload if isinstance(request.payload, dict) else {}
    try:
        control_result = handle_agent_control_message(
            session,
            public_id=run_id,
            session_id=session_id,
            control_type=request.type,
            payload=payload,
        )
    except Exception as exc:  # noqa: BLE001 - 领域错误转成 error 帧，前端按消息处理不抛出
        return {"type": "error", "session_id": session_id, "run_id": run_id, "detail": str(exc)}
    ack = websocket_control_event(control_result.event)
    if control_result.resumed_result is not None:
        ack["resumed_result"] = control_result.resumed_result
    if control_result.resume_diagnostic is not None:
        ack["resume_diagnostic"] = control_result.resume_diagnostic
    return ack
