from __future__ import annotations

import asyncio
import os
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketState

from app.db.deps import SessionDependency
from app.domains.agent_runs.event_types import CONTROL_MESSAGE_TYPES
from app.domains.agent_runs.service import (
    AgentRuntimeError,
    AgentRuntimeUserMessageError,
    handle_agent_control_message,
    record_agent_command_event,
    run_agent_user_message,
    websocket_control_event,
    websocket_stream_events_from_agent_event,
)
from app.domains.book_runs.service import get_book_run
from app.domains.ide.schemas import (
    IdeArtifactPreview,
    IdeCommandRequest,
    IdeCommandResult,
    IdeContextSnapshot,
    IdeDiagnostic,
    IdeSceneRead,
    IdeStoryMemoryQuery,
    IdeStoryMemoryQueryResult,
    IdeWorkspaceTree,
)
from app.domains.ide.service import (
    IdeCommandExecutionError,
    IdeCommandNotFoundError,
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

_API_KEY_HEADER = "x-storyforge-api-key"

_STREAM_EVENT = "stream_event"
_STREAM_RESULT = "result"
_STREAM_ERROR = "error"


def _expected_api_key() -> str:
    return os.getenv("STORYFORGE_API_KEY", "local-dev-key")


async def _accept_or_reject_agent_socket(websocket: WebSocket) -> bool:
    provided_key = websocket.headers.get(_API_KEY_HEADER) or websocket.query_params.get("api_key")
    if provided_key != _expected_api_key():
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False
    await websocket.accept()
    return True


async def _stream_agent_user_message(
    websocket: WebSocket,
    *,
    session_id: str,
    session,
    message: dict[str, Any],
) -> None:
    """Run the sync AgentRuntime off-loop and forward persisted events immediately."""

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
            except Exception as exc:  # noqa: BLE001 - WebSocket worker must always release the receiver loop
                enqueue({"kind": _STREAM_ERROR, "payload": {"type": "error", "session_id": session_id, "detail": str(exc)}})
                return
            enqueue({"kind": _STREAM_RESULT, "payload": runtime_result.result})

    worker = asyncio.create_task(asyncio.to_thread(run_in_thread))
    try:
        while True:
            item = await queue.get()
            kind = item.get("kind")
            payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
            if kind == _STREAM_EVENT:
                await websocket.send_json(payload)
                continue
            if kind == _STREAM_RESULT:
                await websocket.send_json(payload)
                break
            if kind == _STREAM_ERROR:
                await websocket.send_json(payload)
                break
    finally:
        await worker


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


@router.websocket("/agent/sessions/{session_id}")
async def agent_session(websocket: WebSocket, session_id: str, session: SessionDependency) -> None:
    """Agent 双向通道；自然语言编排和写命令都必须复用现有工具目录。"""

    if not await _accept_or_reject_agent_socket(websocket):
        return
    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            if message_type == "user_message":
                stream_events = message.get("stream") is True
                if stream_events:
                    await _stream_agent_user_message(
                        websocket,
                        session_id=session_id,
                        session=session,
                        message=message,
                    )
                    continue
                try:
                    runtime_result = run_agent_user_message(session, agent_session_id=session_id, message=message)
                    result = runtime_result.result
                except AgentRuntimeError as exc:
                    error_payload = {"type": "error", "session_id": session_id, "detail": str(exc)}
                    await websocket.send_json(error_payload)
                    continue
                await websocket.send_json(result)
                continue

            if message_type in CONTROL_MESSAGE_TYPES:
                run_id = str(message.get("run_id") or "")
                if not run_id:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "session_id": session_id,
                            "detail": f"{message_type} 消息缺少 run_id。",
                        }
                    )
                    continue
                payload = message.get("payload") if isinstance(message.get("payload"), dict) else {}
                try:
                    control_result = handle_agent_control_message(
                        session,
                        public_id=run_id,
                        session_id=session_id,
                        control_type=message_type,
                        payload=payload,
                    )
                except Exception as exc:  # noqa: BLE001 - WebSocket 必须把领域错误转为消息
                    await websocket.send_json(
                        {"type": "error", "session_id": session_id, "run_id": run_id, "detail": str(exc)}
                    )
                    continue
                ack = websocket_control_event(control_result.event)
                if control_result.resumed_result is not None:
                    ack["resumed_result"] = control_result.resumed_result
                if control_result.resume_diagnostic is not None:
                    ack["resume_diagnostic"] = control_result.resume_diagnostic
                await websocket.send_json(ack)
                continue

            if message_type != "command":
                await websocket.send_json(
                    {
                        "type": "error",
                        "session_id": session_id,
                        "detail": "Agent 仅支持 user_message 或 command 消息。",
                    }
                )
                continue
            command_id = str(message.get("command_id", ""))
            args = message.get("args") if isinstance(message.get("args"), dict) else {}
            try:
                result = execute_ide_command_by_id(command_id, args, session)
            except (IdeCommandNotFoundError, IdeCommandExecutionError) as exc:
                await websocket.send_json({"type": "error", "session_id": session_id, "detail": str(exc)})
                continue
            result_payload = result.model_dump()
            run_id = str(message.get("run_id") or "")
            if run_id:
                try:
                    record_agent_command_event(
                        session,
                        public_id=run_id,
                        session_id=session_id,
                        command_id=command_id,
                        result_payload=result_payload,
                    )
                except Exception as exc:  # noqa: BLE001 - 命令已执行，事件失败需返回给前端
                    await websocket.send_json(
                        {"type": "error", "session_id": session_id, "run_id": run_id, "detail": str(exc)}
                    )
                    continue
            await websocket.send_json({"type": "command_result", "session_id": session_id, "result": result_payload})
    except WebSocketDisconnect:
        return
    finally:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close()
