from __future__ import annotations

from types import SimpleNamespace

from app.domains.agent_runs.event_encoders import (
    websocket_control_event,
    websocket_stream_events_from_agent_event,
)
from app.domains.agent_runs.event_types import (
    AGENT_PLAN_CREATED,
    AGENT_RUN_COMPLETED,
    AGENT_RUN_FAILED,
    AGENT_RUN_STARTED,
    PERMISSION_APPROVED,
    PERMISSION_DENIED,
    PERMISSION_REQUIRED,
    TOOL_TRACE,
    event_type_for_control_message,
)

# WS 契约金测：把 event_encoders 产出的每类 WS 帧里「前端会解码的键」钉死。
# 桌面壳子在重做，但这些帧形状是后端 → 前端的硬契约：任何一方漂移，重建/守卫失效。
# 对照物是前端 agent-socket.ts 的 isAgent* 守卫与 agent-run-events.ts 的重建逻辑。
# 编码器只读属性、不碰 DB，故用 SimpleNamespace 造 run/event，保持纯单测（无 fixture、秒级）。


def _run(**overrides: object) -> SimpleNamespace:
    base: dict[str, object] = {
        "session_id": "sess-42",
        "public_id": "run-pub-1",
        "assistant_session_id": 7,
        "goal": "给第二章加紧张感",
        "scope": {"agent_role_hints": ["editor", ""], "agent_role_mentions": ["@editor"]},
        "permission_profile": "proposed_patch",
        "status": "completed",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _event(
    run: SimpleNamespace,
    event_type: str,
    payload: dict[str, object],
    *,
    event_id: int = 101,
    sequence: int = 3,
    message: str = "done",
) -> SimpleNamespace:
    event = SimpleNamespace(
        id=event_id,
        run_id=run.public_id,
        event_type=event_type,
        payload=payload,
        sequence=sequence,
        message=message,
    )
    event.run = run
    return event


def _encode(event: SimpleNamespace) -> list[dict[str, object]]:
    return websocket_stream_events_from_agent_event(event)


def test_agent_run_started_frame_carries_fe_consumed_keys() -> None:
    """agent_run_started：前端 isAgentRunStartedMessage 只认 type + str run_id；
    role hints/mentions 是欢迎页 @提及回填所需，空串要被过滤。"""

    frames = _encode(_event(_run(), AGENT_RUN_STARTED, {}))
    assert len(frames) == 1
    frame = frames[0]
    assert frame["type"] == "agent_run_started"
    assert isinstance(frame["run_id"], str) and frame["run_id"]
    assert frame["session_id"] == "sess-42"
    assert frame["user_message"] == "给第二章加紧张感"
    assert frame["agent_role_hints"] == ["editor"]
    assert frame["agent_role_mentions"] == ["@editor"]


def test_agent_step_frames_are_one_per_plan_step_with_fe_keys() -> None:
    """agent_plan_created 展开成一帧一步的 agent_step；前端守卫要 str step + str status。"""

    payload = {
        "plan": [
            {"step": "读取", "detail": "读第二章", "status": "completed"},
            {"step": "改写", "detail": "", "status": "running"},
        ]
    }
    frames = _encode(_event(_run(), AGENT_PLAN_CREATED, payload))
    assert len(frames) == 2
    first = frames[0]
    assert first["type"] == "agent_step"
    assert isinstance(first["step"], str)
    assert isinstance(first["status"], str)
    assert first["index"] == 0
    assert first["run_id"] == "run-pub-1"
    assert first["assistant_session_id"] == 7
    assert "detail" in first
    assert frames[1]["index"] == 1


def test_tool_trace_frame_wraps_trace_object_verbatim() -> None:
    """tool_trace：前端守卫要 object 且非 null 的 trace；trace 内 output_summary
    的 F32 成本键必须原样透传（编码器不得吞键）。"""

    trace = {
        "tool_name": "file.review",
        "status": "completed",
        "input_summary": {},
        "output_summary": {"prompt_tokens": 310, "cost_cny_estimated": 0.031},
    }
    frames = _encode(_event(_run(), TOOL_TRACE, {"index": 2, "trace": trace}))
    assert len(frames) == 1
    frame = frames[0]
    assert frame["type"] == "tool_trace"
    assert isinstance(frame["trace"], dict) and frame["trace"]
    assert frame["trace"]["tool_name"] == "file.review"
    assert frame["index"] == 2
    assert frame["trace"]["output_summary"]["cost_cny_estimated"] == 0.031


def test_permission_required_frame_carries_proposed_patch() -> None:
    """permission_required：前端据 run_id 认帧、据 proposed_patch 弹确认；
    补丁对象必须原样带出（写回确认链的唯一数据源）。"""

    patch = {
        "kind": "file_revision",
        "file_path": "第二章.md",
        "before": "旧正文",
        "after": "新正文",
        "requires_confirmation": True,
        "approval_action": "apply_patch",
    }
    payload = {
        "permission_profile": "proposed_patch",
        "reason": "requires_user_confirmation",
        "proposed_patch": patch,
        "confirmation_action": "apply_patch",
        "blocked_tool": "file.revise",
    }
    frames = _encode(_event(_run(), PERMISSION_REQUIRED, payload))
    assert len(frames) == 1
    frame = frames[0]
    assert frame["type"] == "permission_required"
    assert isinstance(frame["run_id"], str) and frame["run_id"]
    assert frame["proposed_patch"] == patch
    assert frame["permission_profile"] == "proposed_patch"
    assert frame["reason"] == "requires_user_confirmation"


def test_terminal_frames_carry_reconstructable_payload() -> None:
    """F10 跨侧接缝：断线转轮询后前端 reconstructAgentResultFromEvents 从终态事件的
    payload 里读 assistant_session_id / summary 重建 agent_result；failed 用 message 作 error.detail。
    故 completed/failed 帧必须原样带 status + message + 完整 payload。"""

    completed_payload = {
        "assistant_session_id": 7,
        "summary": "已完成第二章加强",
        "intent": "chat.explain",
        "requires_user_confirmation": False,
    }
    completed = _encode(
        _event(_run(), AGENT_RUN_COMPLETED, completed_payload, message="已完成")
    )[0]
    assert completed["type"] == "agent_run_completed"
    assert completed["status"] == "completed"
    assert completed["message"] == "已完成"
    assert completed["payload"]["assistant_session_id"] == 7
    assert completed["payload"]["summary"] == "已完成第二章加强"

    failed = _encode(
        _event(_run(status="failed"), AGENT_RUN_FAILED, {"error": "boom"}, message="运行失败：boom")
    )[0]
    assert failed["type"] == "agent_run_failed"
    assert failed["status"] == "failed"
    assert failed["message"] == "运行失败：boom"


def test_control_message_type_mapping_gotcha() -> None:
    """控制消息回执的 type ≠ 入站 type：前端发 approve_permission，回执是 permission_approved；
    deny 同理。pause/resume/stop/retry 原样透传。前端 isAgentControlAckMessage 认的是映射后的值。"""

    assert event_type_for_control_message("approve_permission") == PERMISSION_APPROVED
    assert PERMISSION_APPROVED == "permission_approved"
    assert event_type_for_control_message("deny_permission") == PERMISSION_DENIED
    assert PERMISSION_DENIED == "permission_denied"
    assert event_type_for_control_message("pause_run") == "pause_run"
    assert event_type_for_control_message("stop_run") == "stop_run"
    assert event_type_for_control_message("retry_from_checkpoint") == "retry_from_checkpoint"


def test_control_ack_frame_shape() -> None:
    """控制回执帧：前端守卫要 status=='recorded' 且 session_id/run_id 为字符串。"""

    ack_event = SimpleNamespace(
        event_type=PERMISSION_APPROVED,
        id=55,
        payload={"session_id": "sess-42", "run_id": "run-pub-1"},
    )
    frame = websocket_control_event(ack_event)
    assert frame["type"] == "permission_approved"
    assert frame["status"] == "recorded"
    assert isinstance(frame["session_id"], str) and frame["session_id"] == "sess-42"
    assert isinstance(frame["run_id"], str) and frame["run_id"] == "run-pub-1"
