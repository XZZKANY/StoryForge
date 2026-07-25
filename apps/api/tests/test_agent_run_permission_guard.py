from __future__ import annotations

from agent_run_test_support import _seed_agent_run, _stored_run_events
from sqlalchemy.orm import Session, sessionmaker


def test_record_permission_required_respects_raced_stop_from_other_connection(
    session: Session,
    session_factory: sessionmaker[Session],
) -> None:
    """UF-01: 末轮产补丁的 post-loop 窗口内，控制通道（另一连接）已把 run 落 stopped，
    record_permission_required 不得用 stale-running 对象盲写 paused 覆盖——它是 B1-001 status
    主线守卫漏掉的第 4 个 status 汇流点（event_sink.py record_permission_required）。"""

    from app.domains.agent_runs.event_sink import _AgentRunEventSink
    from app.domains.agent_runs.service import record_agent_control_event

    run = _seed_agent_run(session, public_id="run-permission-raced-stop")

    # 另一连接（控制通道语义）把 running→stopped 提交；worker 的 run 对象仍 stale-running
    # （expire_on_commit=False 下不会自动看到别的连接已提交的终态）。
    with session_factory() as control_session:
        record_agent_control_event(
            control_session,
            public_id=run.public_id,
            session_id=run.session_id,
            control_type="stop_run",
            payload={"reason": "author stopped during post-loop window"},
        )
    assert run.status == "running"

    _AgentRunEventSink(session).record_permission_required(
        run,
        {
            "agent_result": {"summary": "待确认补丁"},
            "proposed_patch": {"created_by_tool": "file.revise"},
            "intent": "file.revise",
        },
        reason="requires_user_confirmation",
    )

    session.refresh(run)
    # 修复前：被盲写成 "paused"（reap 免疫 + approve 门放行 → 作者的停止被静默复活）。
    assert run.status == "stopped"
    assert run.current_step == "stopped"
    # 尊重控制通道决定：不落 permission-paused、不发 PERMISSION_REQUIRED。
    assert all(event.event_type != "permission_required" for event in _stored_run_events(session, run))


def test_record_permission_required_pauses_running_run_and_emits_event(session: Session) -> None:
    """未被中断时 record_permission_required 仍正常 running→paused 并发 PERMISSION_REQUIRED（happy path 不回归）。"""

    from app.domains.agent_runs.event_sink import _AgentRunEventSink

    run = _seed_agent_run(session, public_id="run-permission-normal-pause")
    _AgentRunEventSink(session).record_permission_required(
        run,
        {
            "agent_result": {"summary": "待确认补丁"},
            "proposed_patch": {"created_by_tool": "file.revise"},
            "intent": "file.revise",
        },
        reason="requires_user_confirmation",
    )

    session.refresh(run)
    assert run.status == "paused"
    assert run.current_step == "permission.confirm"
    events = _stored_run_events(session, run)
    assert events[-1].event_type == "permission_required"
    assert events[-1].payload["proposed_patch"] == {"created_by_tool": "file.revise"}
