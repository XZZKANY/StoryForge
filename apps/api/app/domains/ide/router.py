from __future__ import annotations

import os
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import StreamingResponse
from starlette.websockets import WebSocketState

from app.db.deps import SessionDependency
from app.domains.artifacts.service import ArtifactForbiddenError, ArtifactNotFoundError
from app.domains.book_runs.service import BookRunNotFoundError, get_book_run
from app.domains.ide.orchestrator import AgentOrchestrationError, orchestrate_agent_message
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


def _agent_stream_events_from_result(result: dict[str, Any], *, run_id: str) -> list[dict[str, Any]]:
    """Project the final orchestrator payload into lightweight stream events."""

    session_id = str(result.get("session_id") or "")
    assistant_session_id = result.get("assistant_session_id")
    events: list[dict[str, Any]] = []
    for index, step in enumerate(result.get("plan") if isinstance(result.get("plan"), list) else []):
        if not isinstance(step, dict):
            continue
        events.append(
            {
                "type": "agent_step",
                "session_id": session_id,
                "run_id": run_id,
                "assistant_session_id": assistant_session_id,
                "index": index,
                "step": step.get("step"),
                "detail": step.get("detail"),
                "status": step.get("status"),
            }
        )
    for index, trace in enumerate(result.get("tool_trace") if isinstance(result.get("tool_trace"), list) else []):
        if not isinstance(trace, dict):
            continue
        events.append(
            {
                "type": "tool_trace",
                "session_id": session_id,
                "run_id": run_id,
                "assistant_session_id": assistant_session_id,
                "index": index,
                "trace": trace,
            }
        )
    return events


def _expected_api_key() -> str:
    return os.getenv("STORYFORGE_API_KEY", "local-dev-key")


async def _accept_or_reject_agent_socket(websocket: WebSocket) -> bool:
    provided_key = websocket.headers.get(_API_KEY_HEADER) or websocket.query_params.get("api_key")
    if provided_key != _expected_api_key():
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False
    await websocket.accept()
    return True


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

    try:
        return get_artifact_preview(session, artifact_id, workspace_id=workspace_id)
    except ArtifactForbiddenError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ArtifactNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/runs/{book_run_id}/events",
    summary="读取 IDE BookRun 事件流",
)
def stream_run_events(session: SessionDependency, book_run_id: int) -> StreamingResponse:
    """返回 BookRun 当前状态投影生成的 SSE 快照事件。"""

    try:
        book_run = get_book_run(session, book_run_id)
    except BookRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

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

    try:
        return execute_ide_command_by_id(command_id, (payload or IdeCommandRequest()).args, session)
    except IdeCommandNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except IdeCommandExecutionError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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
                run_id = str(message.get("run_id") or uuid.uuid4().hex)
                if stream_events:
                    await websocket.send_json(
                        {
                            "type": "agent_run_started",
                            "session_id": session_id,
                            "run_id": run_id,
                            "user_message": message.get("user_message") or message.get("message") or message.get("content"),
                        }
                    )
                try:
                    result = orchestrate_agent_message(session, agent_session_id=session_id, message=message)
                except AgentOrchestrationError as exc:
                    error_payload = {"type": "error", "session_id": session_id, "detail": str(exc)}
                    if stream_events:
                        error_payload["run_id"] = run_id
                    await websocket.send_json(error_payload)
                    continue
                if stream_events:
                    result["run_id"] = run_id
                    for event in _agent_stream_events_from_result(result, run_id=run_id):
                        await websocket.send_json(event)
                await websocket.send_json(result)
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
            await websocket.send_json(
                {"type": "command_result", "session_id": session_id, "result": result.model_dump()}
            )
    except WebSocketDisconnect:
        return
    finally:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close()
