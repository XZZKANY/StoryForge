from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.domains.agent_runs import service
from app.domains.agent_runs.event_sink import AgentRunEventSink
from app.domains.agent_runs.models import AgentRun, AgentRunEvent


@pytest.fixture()
def engine(tmp_path):
    """真实文件库/独立物理连接，不以 StaticPool 的共享连接冒充事务隔离。"""
    engine = create_engine(
        f"sqlite+pysqlite:///{tmp_path / 'settlement.sqlite3'}",
        connect_args={"check_same_thread": False, "timeout": 2},
        poolclass=NullPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, connection_record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        connection.exec_driver_sql("BEGIN")
        Base.metadata.create_all(connection)
        connection.commit()
    try:
        yield engine
    finally:
        engine.dispose()


def seed(session: Session, *, status: str = "running") -> AgentRun:
    run = service.create_or_resume_agent_run(
        session, public_id="atomic-run", session_id="atomic-session", goal="验证结算"
    )
    from app.domains.assistant.models import AssistantSession

    session.add(AssistantSession(id=21, title="测试会话", task_type="revision"))
    session.flush()
    run.assistant_session_id = 21
    run.status = status
    run.current_step = "permission.confirm" if status == "paused" else "before-settlement"
    session.commit()
    if status == "paused":
        service.record_agent_event(session, run, event_type="permission_required", actor="test", payload={
            "assistant_session_id": 21, "requires_user_confirmation": True,
        })
    return run


def observe(engine, run_id: int) -> tuple[str, str | None, list[tuple[str, dict]]]:
    with Session(engine) as observer:
        run = observer.get(AgentRun, run_id)
        assert run is not None
        events = list(
            observer.scalars(
                select(AgentRunEvent).where(AgentRunEvent.run_id == run_id).order_by(AgentRunEvent.sequence)
            )
        )
        return run.status, run.current_step, [(e.event_type, e.payload) for e in events]


RESULT = {
    "intent": "file.revise",
    "assistant_session_id": 21,
    "agent_result": {
        "summary": "修改已准备好",
        "confirmation_action": "apply_patch",
        "confirmation_kind": "patch",
        "chapter_brief": {"title": "测试"},
        "chat_loop": {"rounds": 2, "tool_call_count": 1},
    },
    "proposed_patch": {
        "id": "patch-1",
        "created_by_tool": "file.revise",
        "file_path": "chapter.md",
        "before_content": "原文",
        "after_content": "修订",
        "api_key": "fixture-secret",
    },
}

CASES = [
    ("complete", "running", "completed", "agent_run_completed"),
    ("fail", "running", "failed", "agent_run_failed"),
    ("permission", "running", "paused", "permission_required"),
    ("approve_permission", "paused", "completed", "agent_run_completed"),
    ("deny_permission", "paused", "failed", "agent_run_failed"),
    ("reap", "running", "failed", "agent_run_failed"),
]


def settle(session: Session, run: AgentRun, action: str, *, on_event=None) -> None:
    sink = AgentRunEventSink(session, on_event=on_event)
    if action == "complete":
        sink.complete(run, RESULT)
    elif action == "fail":
        sink.fail(run, message="测试失败", payload={"reason": "fixture", "api_key": "fixture-secret"})
    elif action == "permission":
        sink.record_permission_required(run, RESULT, reason="confirm_patch")
    elif action == "reap":
        assert service.reap_non_terminal_agent_runs(session) == 1
    else:
        service.record_agent_control_event(
            session, public_id=run.public_id, session_id=run.session_id, control_type=action
        )


class SettlementFailure(RuntimeError):
    pass


@contextmanager
def fail_event_write(engine, *, run_id: int, event_type: str, stage: str) -> Generator[list, None, None]:
    observations = []

    def before_insert(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO agent_run_events") and any(
            values.get("event_type") == event_type for values in context.compiled_parameters
        ):
            observations.append(observe(engine, run_id))
            if stage == "insert":
                raise SettlementFailure("event insert failed")

    def before_commit(connection):
        if (
            stage == "commit"
            and connection.scalar(
                select(AgentRunEvent.id).where(AgentRunEvent.run_id == run_id, AgentRunEvent.event_type == event_type)
            )
            is not None
        ):
            raise SettlementFailure("settlement commit failed")

    event.listen(engine, "before_cursor_execute", before_insert)
    event.listen(engine, "commit", before_commit)
    try:
        yield observations
    finally:
        event.remove(engine, "before_cursor_execute", before_insert)
        event.remove(engine, "commit", before_commit)


@pytest.mark.parametrize("action,initial,terminal,event_type", CASES)
@pytest.mark.parametrize("stage", ["insert", "commit"])
def test_settlement_failure_rolls_back_pair_and_same_session_can_retry(
    session, engine, action, initial, terminal, event_type, stage
):
    run = seed(session, status=initial)
    run_id = run.id
    with Session(engine) as observer:
        assert (
            session.connection().connection.driver_connection is not observer.connection().connection.driver_connection
        )
    with (
        fail_event_write(engine, run_id=run_id, event_type=event_type, stage=stage) as observations,
        pytest.raises(SettlementFailure),
    ):
        settle(session, run, action)
    status, step, events = observe(engine, run_id)
    assert (status, step) == (initial, "permission.confirm" if initial == "paused" else "before-settlement")
    assert not any(kind == event_type for kind, _ in events)
    assert observations and observations[0][:2] == (initial, "permission.confirm" if initial == "paused" else "before-settlement")
    if action.endswith("_permission"):
        assert [kind for kind, _ in events] == [
            "permission_required",
            "permission_approved" if action.startswith("approve") else "permission_denied"
        ]
    # 失败不得留下待提交的 terminal 状态；一次无关 commit 也不能把它漏落库。
    session.commit()
    assert observe(engine, run_id)[:2] == (initial, "permission.confirm" if initial == "paused" else "before-settlement")
    settle(session, run, action)
    status, _, events = observe(engine, run_id)
    assert status == terminal
    assert sum(kind == event_type for kind, _ in events) == 1


@pytest.mark.parametrize("action,initial,terminal,event_type", CASES[:3])
def test_callback_observes_committed_pair_and_failure_cannot_undo_it(
    session, engine, action, initial, terminal, event_type
):
    run = seed(session, status=initial)
    run_id = run.id
    seen = []

    def notify(record):
        seen.append(observe(engine, run_id))
        assert record.event_type == event_type
        raise SettlementFailure("delivery failed after commit")

    with pytest.raises(SettlementFailure):
        settle(session, run, action, on_event=notify)
    assert seen[0][0] == terminal
    assert seen[0][2][-1][0] == event_type
    # 外层异常处理不得补出相反的 failed 状态/事件。
    service.fail_agent_run(session, run, message="late callback failure")
    assert observe(engine, run_id) == seen[0]


@pytest.mark.parametrize("action", ["complete", "fail", "permission"])
def test_settlement_respects_stop_from_another_connection(session, engine, action):
    run = seed(session)
    with Session(engine) as control:
        current = control.get(AgentRun, run.id)
        current.status = "stopped"
        current.current_step = "stopped"
        control.commit()
    settle(session, run, action)
    assert observe(engine, run.id) == ("stopped", "stopped", [])


def test_terminal_payload_reconstruction_redaction_and_trim_remain(session, engine):
    run = seed(session)
    settle(session, run, "permission")
    payload = observe(engine, run.id)[2][-1][1]
    assert payload["assistant_session_id"] == 21
    assert payload["summary"] == "修改已准备好"
    assert payload["proposed_patch"]["after_content"] == "修订"
    assert payload["proposed_patch"]["api_key"] == "[REDACTED]"
    assert payload["confirmation_action"] == "apply_patch"
    assert payload["confirmation_kind"] == "patch"
    assert payload["chapter_brief"] == {"title": "测试"}
    run.status = "running"
    session.commit()
    settle(session, run, "complete")
    payload = observe(engine, run.id)[2][-1][1]
    assert payload["assistant_session_id"] == 21
    assert payload["chat_loop"] == {"rounds": 2, "tool_call_count": 1}
    assert payload["proposed_patch"] == {"id": "patch-1", "created_by_tool": "file.revise", "file_path": "chapter.md"}


def test_control_endpoint_does_not_acknowledge_failed_settlement(client, session, engine):
    run = seed(session, status="paused")
    with fail_event_write(engine, run_id=run.id, event_type="agent_run_completed", stage="insert"):
        response = client.post(
            f"/api/ide/agent/sessions/{run.session_id}/control",
            json={"type": "approve_permission", "run_id": run.public_id, "payload": {}},
        )
    assert response.status_code == 200
    assert response.json()["type"] == "error"
    assert observe(engine, run.id)[0] == "paused"


@pytest.mark.parametrize("exhaust", [False, True])
def test_sequence_conflict_savepoint_does_not_split_settlement(session, engine, exhaust):
    run = seed(session)
    run_id = run.id
    service.record_agent_event(session, run, event_type="tool_trace", actor="fixture")
    conflicts = []

    def collide(flushing_session, *_args):
        pending = next((item for item in flushing_session.new if isinstance(item, AgentRunEvent)), None)
        if pending is None or (conflicts and not exhaust):
            return
        conflicts.append(pending.sequence)
        flushing_session.connection().exec_driver_sql(
            "INSERT INTO agent_run_events (run_id,event_type,actor,message,payload,sequence) "
            "VALUES (?, 'tool_trace', 'rival', '', '{}', ?)",
            (run_id, pending.sequence),
        )

    event.listen(session, "before_flush", collide)
    try:
        if exhaust:
            from sqlalchemy.exc import IntegrityError

            with pytest.raises(IntegrityError):
                settle(session, run, "complete")
            assert observe(engine, run_id)[0] == "running"
        else:
            settle(session, run, "complete")
    finally:
        event.remove(session, "before_flush", collide)
    assert len(conflicts) == (5 if exhaust else 1)
    if exhaust:
        settle(session, run, "complete")
    with Session(engine) as observer:
        rows = list(observer.scalars(select(AgentRunEvent).order_by(AgentRunEvent.sequence)))
        assert [(e.sequence, e.event_type) for e in rows] == [(1, "tool_trace"), (2, "agent_run_completed")]
        assert observer.get(AgentRun, run_id).status == "completed"


def test_post_commit_refresh_failure_keeps_committed_pair(session, engine, monkeypatch):
    run = seed(session)
    refresh = session.refresh

    def reject_event_refresh(instance, *args, **kwargs):
        if isinstance(instance, AgentRunEvent):
            raise SettlementFailure("refresh failed after commit")
        return refresh(instance, *args, **kwargs)

    monkeypatch.setattr(session, "refresh", reject_event_refresh)
    with pytest.raises(SettlementFailure):
        settle(session, run, "complete")
    state = observe(engine, run.id)
    assert state[0] == "completed"
    assert state[2][-1][0] == "agent_run_completed"
    service.fail_agent_run(session, run, message="late refresh failure")
    assert observe(engine, run.id) == state


def seed_book_mirror(session, session_factory):
    from test_book_runs import seed_locked_blueprint

    from app.domains.book_runs.models import BookRun

    scope = seed_locked_blueprint(session_factory)
    book_run = BookRun(**scope, status="running", total_chapters=3, checkpoint=[])
    session.add(book_run)
    session.commit()
    mirror = service.record_book_run_snapshot(session, book_run=book_run, source="fixture.start")
    return book_run, mirror


@pytest.mark.parametrize(
    "status,event_type", [("completed", "agent_run_completed"), ("failed", "agent_run_failed"), ("stopped", "stop_run")]
)
@pytest.mark.parametrize("stage", ["insert", "commit"])
def test_bookrun_settlement_failure_preserves_upstream_and_can_retry(
    session, session_factory, engine, status, event_type, stage
):
    from app.domains.book_runs.models import BookRun

    book_run, mirror = seed_book_mirror(session, session_factory)
    run_id, book_id = mirror.id, book_run.id
    book_run.status = status
    book_run.checkpoint = [{"chapter_index": 1}]
    session.commit()  # 上游事实先提交；镜像故障不得撤销它。
    with (
        fail_event_write(engine, run_id=run_id, event_type=event_type, stage=stage),
        pytest.raises(SettlementFailure),
    ):
        service.record_book_run_snapshot(session, book_run=book_run, source="fixture.finish")
    assert observe(engine, run_id)[0] == "running"
    assert not any(kind == event_type for kind, _ in observe(engine, run_id)[2])
    with Session(engine) as observer:
        upstream = observer.get(BookRun, book_id)
        assert upstream.status == status
        assert upstream.checkpoint == [{"chapter_index": 1}]
    service.record_book_run_snapshot(session, book_run=book_run, source="fixture.retry")
    state = observe(engine, run_id)
    assert state[0] == status
    assert state[2][-1][0] == event_type
    assert state[2][-1][1]["source"] == "fixture.retry"
    assert state[2][-1][1]["writing_run_id"] == book_id
    assert state[2][-1][1]["permission_profile"] == "ask"


@pytest.mark.parametrize(
    "status,event_type", [("completed", "agent_run_completed"), ("failed", "agent_run_failed"), ("stopped", "stop_run")]
)
@pytest.mark.parametrize("fail_at", ["tool_trace", "terminal"])
def test_repeated_bookrun_terminal_snapshot_never_reopens_mirror(
    session, session_factory, engine, status, event_type, fail_at
):
    book_run, mirror = seed_book_mirror(session, session_factory)
    book_run.status = status
    session.commit()
    service.record_book_run_snapshot(session, book_run=book_run, source="fixture.finish")
    count_before = sum(kind == event_type for kind, _ in observe(engine, mirror.id)[2])
    target = event_type if fail_at == "terminal" else fail_at
    with (
        fail_event_write(engine, run_id=mirror.id, event_type=target, stage="insert"),
        pytest.raises(SettlementFailure),
    ):
        service.record_book_run_snapshot(session, book_run=book_run, source="fixture.repeat")
    # 普通 trace 的失败沿用调用方清理，但已经持久化的状态绝不能变为 running。
    session.rollback()
    assert observe(engine, mirror.id)[0] == status
    service.record_book_run_snapshot(session, book_run=book_run, source="fixture.retry")
    state = observe(engine, mirror.id)
    assert state[0] == status
    assert sum(kind == event_type for kind, _ in state[2]) == count_before + 1


def test_bookrun_explicit_checkpoint_retry_can_reopen_and_settle_again(session, session_factory, engine):
    from app.domains.writing_runs.service import retry_writing_run_from_checkpoint

    book_run, mirror = seed_book_mirror(session, session_factory)
    book_run.status = "failed"
    book_run.checkpoint = [{"chapter_index": 1}]
    session.commit()
    service.record_book_run_snapshot(session, book_run=book_run, source="fixture.failure")
    retry_writing_run_from_checkpoint(session, book_run_id=book_run.id)
    service.record_book_run_snapshot(session, book_run=book_run, source="fixture.resume")
    assert observe(engine, mirror.id)[0] == "running"
    book_run.status = "completed"
    session.commit()
    service.record_book_run_snapshot(session, book_run=book_run, source="fixture.finish")
    assert observe(engine, mirror.id)[0] == "completed"


@pytest.mark.parametrize("stage", ["update", "commit"])
def test_unanchored_resume_stop_and_diagnostic_are_atomic(session, engine, stage, monkeypatch):
    run = seed(session, status="paused")
    # This exercises unanchored pause, not a permission wait that resume cannot bypass.
    run.current_step = "paused"
    session.commit()
    run_id = run.id

    def reject_update(connection, cursor, statement, parameters, context, executemany):
        if stage == "update" and statement.startswith("UPDATE agent_run_events") and "resume_diagnostic" in str(parameters):
            raise SettlementFailure("resume diagnostic update failed")

    def reject_commit(connection):
        if stage == "commit" and connection.scalar(select(AgentRun.status).where(AgentRun.id == run_id)) == "stopped":
            raise SettlementFailure("resume diagnostic commit failed")

    def unexpected_execute(*args, **kwargs):
        pytest.fail("no pending call must not execute")

    monkeypatch.setattr(service, "execute_agent_user_message_run", unexpected_execute)
    event.listen(engine, "before_cursor_execute", reject_update)
    event.listen(engine, "commit", reject_commit)
    try:
        with pytest.raises(SettlementFailure):
            service.handle_agent_control_message(
                session,
                public_id=run.public_id,
                session_id=run.session_id,
                control_type="resume_run",
            )
    finally:
        event.remove(engine, "before_cursor_execute", reject_update)
        event.remove(engine, "commit", reject_commit)
    # RESUME 命令与 running/resumed 已提交；只回滚本次 parking，不伪称回到 paused。
    state = observe(engine, run_id)
    assert state[:2] == ("running", "resumed")
    assert "runtime_recovery" not in state[2][-1][1]
    session.commit()
    assert observe(engine, run_id) == state
    service.handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
    )
    state = observe(engine, run_id)
    assert state[:2] == ("stopped", "stopped")
    resume_event = next(payload for kind, payload in reversed(state[2]) if kind == "resume_run")
    assert resume_event["runtime_recovery"]["resume_diagnostic"]["reason"] == "no_pending_call"
    assert state[2][-1][0] == "agent_run_interrupted"


def test_upstream_failure_settles_paused_mirror_without_weakening_worker_guard(session, session_factory, engine):
    book_run, mirror = seed_book_mirror(session, session_factory)
    mirror.status = "paused"
    session.commit()
    service.fail_agent_run(session, mirror, message="late worker failure")
    assert observe(engine, mirror.id)[0] == "paused"
    book_run.status = "failed"
    session.commit()
    service.record_book_run_snapshot(session, book_run=book_run, source="fixture.failure")
    state = observe(engine, mirror.id)
    assert state[:2] == ("failed", "failed")
    assert state[2][-1][0] == "agent_run_failed"


@pytest.mark.parametrize(
    "command,event_type", [("approve_permission", "agent_run_completed"), ("deny_permission", "agent_run_failed")]
)
def test_repeated_permission_control_audits_each_command_but_settles_once(session, engine, command, event_type):
    run = seed(session, status="paused")
    settle(session, run, command)
    settle(session, run, command)
    events = observe(engine, run.id)[2]
    assert sum(kind == event_type for kind, _ in events) == 1
    assert sum(payload.get("control_type") == command for kind, payload in events if kind != event_type) == 2
