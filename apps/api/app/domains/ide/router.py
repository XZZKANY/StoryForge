from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import sessionmaker

from app.common.llm_client import LLMError
from app.common.llm_env import missing_llm_env, resolved_llm_env
from app.db.deps import SessionDependency
from app.domains.agent_runs.event_types import CONTROL_MESSAGE_TYPES
from app.domains.agent_runs.external_admission import admit_stream_protocol
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.permission import PermissionProfileError, normalize_permission_profile
from app.domains.agent_runs.service import (
    AgentRuntimeError,
    AgentRuntimeUserMessageError,
    handle_agent_control_message,
    run_agent_user_message,
    websocket_control_event,
    websocket_stream_events_from_agent_event,
)
from app.domains.agent_runs.writeback_contracts import ExecutionProtocol
from app.domains.book_runs.service import get_book_run
from app.domains.ide.cross_chapter_consistency import check_cross_chapter_consistency
from app.domains.ide.schemas import (
    IdeCommandRequest,
    IdeCommandResult,
    IdeCrossChapterRequest,
    IdeCrossChapterResult,
)
from app.domains.ide.service import (
    build_run_events,
    encode_sse_event,
    execute_ide_command_by_id,
)
from app.domains.ide.stream_measurement import StreamMeasurement
from app.domains.ide.stream_queue import QueueGetTimeout, WorkerStreamQueue

router = APIRouter(prefix="/api/ide", tags=["IDE 工作台"])

_STREAM_EVENT = "stream_event"
_STREAM_RESULT = "result"
_STREAM_ERROR = "error"

# Consumer-side text coalescing: the first delta of a round flushes immediately; later
# deltas merge into one frame on a short window or character budget, then chunk_sequence is
# renumbered contiguously. Worker production and back-pressure are untouched.
_TEXT_COALESCE_WINDOW_SECONDS = 0.04
_TEXT_COALESCE_MAX_CHARS = 4096


def _is_text_delta(payload: dict[str, Any]) -> bool:
    return payload.get("type") == "agent_text_delta"


def _same_text_stream(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return (
        left.get("run_id") == right.get("run_id")
        and left.get("stream_id") == right.get("stream_id")
        and left.get("round_index") == right.get("round_index")
    )


class _TextDeltaCoalescer:
    """Merge consecutive same-stream text deltas behind a short, bounded window.

    The first delta of each stream round is emitted immediately; subsequent deltas are
    buffered until the window elapses, the character budget fills, or a non-delta frame forces
    a flush. chunk_sequence is renumbered contiguously at flush time.
    """

    def __init__(self) -> None:
        self._pending: dict[str, Any] | None = None
        self._emitted_rounds: set[tuple[Any, Any, Any]] = set()
        self._next_sequence: dict[tuple[Any, Any, Any], int] = {}

    def _round_key(self, payload: dict[str, Any]) -> tuple[Any, Any, Any]:
        return (payload.get("run_id"), payload.get("stream_id"), payload.get("round_index"))

    def _take_pending(self) -> dict[str, Any] | None:
        pending = self._pending
        self._pending = None
        return pending

    def _renumber(self, frame: dict[str, Any] | None) -> dict[str, Any] | None:
        """Rewrites chunk_sequence to the per-round contiguous logical sequence."""
        if frame is None:
            return None
        key = self._round_key(frame)
        sequence = self._next_sequence.get(key, 1)
        frame["chunk_sequence"] = sequence
        self._next_sequence[key] = sequence + 1
        return frame

    def feed(self, payload: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
        """Returns (frames to emit now, whether a flush timer should be armed)."""
        if not _is_text_delta(payload):
            flushed = self._renumber(self._take_pending())
            return ([flushed, payload] if flushed is not None else [payload], False)

        pending = self._pending
        if pending is not None and not _same_text_stream(pending, payload):
            # A new stream/round must not absorb the previous one; flush it, then buffer fresh.
            flushed = self._renumber(self._take_pending())
            self._pending = dict(payload)
            return ([flushed], True)

        key = self._round_key(payload)
        if pending is None:
            self._pending = dict(payload)
            if key not in self._emitted_rounds:
                # First delta of this stream round: ship it now, do not arm a window.
                self._emitted_rounds.add(key)
                first = self._renumber(self._take_pending())
                return ([first], False)
            return ([], True)

        if len(pending["text_delta"]) + len(payload["text_delta"]) > _TEXT_COALESCE_MAX_CHARS:
            # Character budget reached: ship the merged frame, start a fresh pending window.
            flushed = self._renumber(self._take_pending())
            self._pending = dict(payload)
            return ([flushed], True)

        pending["text_delta"] = pending["text_delta"] + payload["text_delta"]
        return ([], True)

    def flush(self) -> dict[str, Any] | None:
        return self._renumber(self._take_pending())


async def _agent_user_message_payloads(session, *, session_id: str, message: dict[str, Any], external_lease=None):
    """跑同步 AgentRuntime（off-loop），按事件顺序产出前端帧 payload，终态帧（result/error）后收尾。

    本地 SSE 流以该 pump 为唯一运行入口；帧形状由 event_encoders / ws_messages 管理。
    """

    measurement = StreamMeasurement()
    loop = asyncio.get_running_loop()
    queue = WorkerStreamQueue(loop)
    session_bind = session.get_bind()
    thread_session_factory = sessionmaker(bind=session_bind, autoflush=False, autocommit=False, expire_on_commit=False)

    def enqueue(item: dict[str, Any]) -> None:
        queue.put(item)

    def on_event(event) -> None:  # noqa: ANN001 - callback receives ORM AgentRunEvent from runtime thread
        for payload in websocket_stream_events_from_agent_event(event):
            enqueue({"kind": _STREAM_EVENT, "payload": payload})

    def run_in_thread() -> None:
        with measurement.worker() as worker_span, thread_session_factory() as thread_session:
            try:
                runtime_result = run_agent_user_message(
                    thread_session,
                    agent_session_id=session_id,
                    message=message,
                    on_event=on_event,
                    on_text=lambda frame: enqueue({"kind": _STREAM_EVENT, "payload": frame.to_wire()}),
                    external_lease=external_lease,
                )
            except AgentRuntimeError as exc:
                worker_span.outcome("error")
                payload: dict[str, Any] = {"type": "error", "session_id": session_id, "detail": str(exc)}
                if isinstance(exc, AgentRuntimeUserMessageError):
                    payload["run_id"] = exc.run.public_id
                enqueue({"kind": _STREAM_ERROR, "payload": payload})
                return
            except Exception as exc:  # noqa: BLE001 - worker must always release the receiver loop
                worker_span.outcome("error")
                enqueue({"kind": _STREAM_ERROR, "payload": {"type": "error", "session_id": session_id, "detail": str(exc)}})
                return
            enqueue({"kind": _STREAM_RESULT, "payload": runtime_result.result})

    worker = asyncio.create_task(asyncio.to_thread(run_in_thread))
    stream_status = "ok"
    coalescer = _TextDeltaCoalescer()
    flush_deadline: float | None = None
    try:
        while True:
            # This is a fixed window, not an idle debounce. Check the deadline even when
            # the queue stays nonempty, and never renew it just because a delta arrived.
            remaining = None if flush_deadline is None else flush_deadline - loop.time()
            if remaining is not None and remaining <= 0:
                item = None
            elif remaining is not None:
                try:
                    item = await queue.get(timeout=remaining)
                except QueueGetTimeout:
                    item = None
            else:
                item = await queue.get()
            if item is None:
                flushed = coalescer.flush()
                flush_deadline = None
                if flushed is not None:
                    measurement.before_yield(flushed)
                    yield flushed
                continue
            kind = item.get("kind")
            payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
            if kind in (_STREAM_RESULT, _STREAM_ERROR):
                # Terminal frames flush any buffered text, then pass through untouched.
                flushed = coalescer.flush()
                flush_deadline = None
                if flushed is not None:
                    measurement.before_yield(flushed)
                    yield flushed
                measurement.before_yield(payload)
                if kind == _STREAM_ERROR:
                    stream_status = "error"
                yield payload
                break
            frames, window_armed = coalescer.feed(payload)
            if not window_armed:
                flush_deadline = None
            elif flush_deadline is None or frames:
                # A size/stream-boundary flush starts a fresh buffer and therefore a new window.
                flush_deadline = loop.time() + _TEXT_COALESCE_WINDOW_SECONDS
            for frame in frames:
                measurement.before_yield(frame)
                yield frame
    except (asyncio.CancelledError, GeneratorExit):
        stream_status = "cancelled"
        raise
    except Exception:
        stream_status = "error"
        raise
    finally:
        queue.close()
        measurement.transport_finished(stream_status)
        await worker


def _sse_data_frame(payload: dict[str, Any]) -> str:
    """把前端帧 payload 编成 SSE data 帧；前端按 payload.type 判别式解码。"""

    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _agent_user_message_sse(session, *, session_id: str, message: dict[str, Any], external_lease=None):
    async for payload in _agent_user_message_payloads(session, session_id=session_id, message=message, external_lease=external_lease):
        yield _sse_data_frame(payload)


@router.post(
    "/review/cross-chapter",
    response_model=IdeCrossChapterResult,
    summary="跨章一致性检查",
)
def cross_chapter_consistency_endpoint(payload: IdeCrossChapterRequest) -> IdeCrossChapterResult:
    """对若干完整章节做跨章一致性审校,返回带原文出处的硬冲突(时间线/称谓/设定/角色离场/伏笔)。"""

    missing = missing_llm_env()
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
    except LLMError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"跨章一致性 LLM 调用失败：{exc}",
        ) from exc
    return IdeCrossChapterResult.model_validate(result)


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
    execution_protocol: ExecutionProtocol = "legacy"
    args: dict[str, Any] = Field(default_factory=dict)

    @field_validator("permission_profile")
    @classmethod
    def validate_permission_profile(cls, value: str | None) -> str | None:
        try:
            normalize_permission_profile(value)
        except PermissionProfileError as exc:
            raise ValueError(str(exc)) from exc
        return value


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
    host_generation: str | None = Header(default=None, alias="X-StoryForge-Host-Generation"),
) -> StreamingResponse:
    """本地 SSE 直播工具循环：替代 WS user_message 流；控制走 /agent/sessions/{id}/control。"""

    try:
        external_lease = admit_stream_protocol(session, protocol=request.execution_protocol, session_id=session_id,
                                               run_id=request.run_id, host_generation=host_generation, intent=request.intent)
    except ExternalWritebackConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    message: dict[str, Any] = {
        "type": "user_message",
        "stream": True,
        "run_id": external_lease.run_id if external_lease is not None else request.run_id,
        "user_message": request.user_message,
        "assistant_session_id": request.assistant_session_id,
        "intent": request.intent,
        "permission_profile": request.permission_profile,
        "args": request.args or {},
    }
    return StreamingResponse(
        _agent_user_message_sse(session, session_id=session_id, message=message, external_lease=external_lease),
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
