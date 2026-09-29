from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.domains.agent_runs import service
from app.domains.agent_runs.models import AgentRunEvent
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.assistant.models import AssistantSession


@pytest.fixture()
def control_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'control.sqlite'}", poolclass=NullPool)
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    yield engine
    engine.dispose()


def seed(session):
    session.add(AssistantSession(id=21, title="Control test", task_type="revision"))
    session.commit()
    run = service.create_or_resume_agent_run(session, public_id="control-run", session_id="control-session", goal="revise")
    run.assistant_session_id = 21
    session.commit()
    return run


def result(*, permission=False):
    return {
        "type": "agent_result", "run_id": "control-run", "session_id": "control-session",
        "assistant_session_id": 21, "intent": "file.revise", "user_message": "revise",
        "plan": [], "tool_trace": [],
        "agent_result": {"summary": "result", "requires_user_confirmation": permission},
        "proposed_patch": {"id": "old-patch", "after_content": "not delivered"} if permission else None,
    }


def control(engine, kind="stop_run"):
    with Session(engine) as session:
        response = service.handle_agent_control_message(session, public_id="control-run", session_id="control-session", control_type=kind)
        return service.websocket_control_event(response.event)


def events(engine):
    with Session(engine) as session:
        return list(session.scalars(select(AgentRunEvent).order_by(AgentRunEvent.sequence)))


def execute(session, run):
    return service.execute_agent_user_message_run(session, run=run, agent_session_id="control-session", message={"user_message": "revise"})


def park_permission(session, run):
    run.status = "paused"
    run.current_step = "permission.confirm"
    service.record_agent_event(session, run, event_type="permission_required", actor="test", payload={
        "assistant_session_id": 21, "proposed_patch": result(permission=True)["proposed_patch"],
        "execution_result": result(permission=True),
    })


def test_control_ack_is_requested_until_worker_really_returns(control_engine, monkeypatch):
    acks = []

    def run_message(self, session, *, run, **kwargs):
        acks.append(control(control_engine))
        return result()

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        response = execute(session, seed(session))
    assert acks[0]["status"] == "recorded"
    assert acks[0]["control_effect"] == "requested"
    assert acks[0]["runtime_state"] == "in_flight"
    assert response["agent_result"]["runtime_interrupted"] is True
    settled = [event for event in events(control_engine) if event.event_type == "agent_run_interrupted"]
    assert len(settled) == 1
    assert settled[0].payload["execution_result"] == response
    assert settled[0].payload["runtime_state"] == "settled"


def test_permission_event_does_not_falsely_prove_worker_exit(control_engine, monkeypatch):
    acks = []

    def run_message(self, session, *, run, **kwargs):
        park_permission(session, run)
        acks.append(control(control_engine))
        assert not any(event.event_type == "agent_run_interrupted" for event in events(control_engine))
        return result(permission=True)

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        response = execute(session, seed(session))
    assert acks[0]["control_effect"] == "requested"
    assert acks[0]["runtime_state"] == "in_flight"
    assert response["proposed_patch"] is None
    assert response["runtime_interruption"]["status"] == "stopped"


def test_stop_after_parked_permission_supersedes_patch_replay(control_engine, monkeypatch):
    def run_message(self, session, *, run, **kwargs):
        park_permission(session, run)
        return result(permission=True)

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        response = execute(session, seed(session))
    assert response["proposed_patch"]["id"] == "old-patch"
    ack = control(control_engine)
    assert ack["control_effect"] == "applied"
    assert ack["runtime_state"] == "settled"
    terminals = [event for event in events(control_engine) if event.event_type in {"permission_required", "agent_run_interrupted"}]
    assert terminals[-1].event_type == "agent_run_interrupted"
    replay = terminals[-1].payload["execution_result"]
    assert replay["proposed_patch"] is None
    assert replay["agent_result"]["requires_user_confirmation"] is False
    assert replay["runtime_interruption"]["status"] == "stopped"
    assert "not delivered" not in str(replay)
    with Session(control_engine) as session:
        projection = service.get_agent_run_save_points(session, "control-run")
    assert projection["pending"]["permission_required"] is False
    assert projection["interruption_model"]["has_interrupted_event"] is True


def test_late_stop_is_ignored_and_does_not_overwrite_completed(control_engine):
    with Session(control_engine) as session:
        run = seed(session)
        service.complete_agent_run(session, run, result=result())
    ack = control(control_engine)
    assert ack["control_effect"] == "ignored"
    assert ack["run_status"] == "completed"
    assert not any(event.event_type == "agent_run_interrupted" for event in events(control_engine))


def test_exception_exit_still_marks_execution_settled(control_engine, monkeypatch):
    def run_message(self, session, *, run, **kwargs):
        raise RuntimeError("fixture failure")

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        run = seed(session)
        with pytest.raises(RuntimeError, match="fixture failure"):
            execute(session, run)
    markers = [event for event in events(control_engine) if event.event_type.startswith("agent_execution_")]
    assert [event.event_type for event in markers] == ["agent_execution_started", "agent_execution_settled"]
    assert markers[-1].payload["execution_id"] == markers[0].id
    assert markers[-1].payload["runtime_state"] == "settled"


def test_repeated_stop_does_not_duplicate_interrupted_settlement(control_engine, monkeypatch):
    def run_message(self, session, *, run, **kwargs):
        control(control_engine)
        return result()

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        execute(session, seed(session))
    ack = control(control_engine)
    assert ack["control_effect"] == "ignored"
    assert ack["runtime_state"] == "settled"
    assert len([event for event in events(control_engine) if event.event_type == "agent_run_interrupted"]) == 1


def test_resume_during_inflight_pause_never_starts_another_worker(control_engine, monkeypatch):
    acks, calls = [], []

    def run_message(self, session, *, run, **kwargs):
        calls.append(run.public_id)
        acks.append(control(control_engine, "pause_run"))
        acks.append(control(control_engine, "resume_run"))
        return result()

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        response = execute(session, seed(session))
    assert acks[0]["control_effect"] == "requested"
    assert acks[1]["control_effect"] == "ignored"
    assert acks[1]["runtime_state"] == "in_flight"
    assert response["runtime_interruption"]["status"] == "paused"
    assert calls == ["control-run"]


def test_late_stop_while_completed_worker_is_unwinding_is_ignored(control_engine, monkeypatch):
    acks = []

    def run_message(self, session, *, run, **kwargs):
        service.complete_agent_run(session, run, result=result())
        acks.append(control(control_engine))
        return result()

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        response = execute(session, seed(session))
    assert acks[0]["control_effect"] == "ignored"
    assert acks[0]["runtime_state"] == "in_flight"
    assert acks[0]["run_status"] == "completed"
    assert "runtime_interruption" not in response
    assert not any(event.event_type == "agent_run_interrupted" for event in events(control_engine))


def test_stop_of_partial_permission_keeps_execution_outcome_and_revokes_only_patch(control_engine, monkeypatch):
    def run_message(self, session, *, run, **kwargs):
        parked = result(permission=True)
        parked["agent_result"]["execution_outcome"] = {"status": "partial", "code": "max_rounds", "message": "unfinished"}
        run.status = "paused"
        run.current_step = "permission.confirm"
        service.record_agent_event(session, run, event_type="permission_required", actor="test", payload={"execution_result": parked})
        return parked

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        execute(session, seed(session))
    control(control_engine)
    persisted = events(control_engine)
    prior = next(event for event in persisted if event.event_type == "permission_required")
    latest = next(event for event in reversed(persisted) if event.event_type == "agent_run_interrupted")
    assert prior.payload["execution_result"]["agent_result"]["execution_outcome"]["status"] == "partial"
    assert latest.payload["execution_result"]["agent_result"]["execution_outcome"] == prior.payload["execution_result"]["agent_result"]["execution_outcome"]
    assert latest.payload["execution_result"]["proposed_patch"] is None


def test_no_anchor_resume_replay_supersedes_old_paused_result(control_engine, monkeypatch):
    def run_message(self, session, *, run, **kwargs):
        control(control_engine, "pause_run")
        return result()

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        execute(session, seed(session))
    ack = control(control_engine, "resume_run")
    assert ack["run_status"] == "stopped"
    interrupted = [event for event in events(control_engine) if event.event_type == "agent_run_interrupted"]
    assert [event.payload["execution_result"]["runtime_interruption"]["status"] for event in interrupted] == ["paused", "stopped"]


def test_public_service_brief_stays_a_confirmation_not_author_pause(control_engine, tmp_path, monkeypatch):
    from app.domains.assistant import service as assistant_service

    project = tmp_path / "project"
    project.mkdir()
    target = project / "chapter.md"
    target.write_text("", encoding="utf-8")
    monkeypatch.setattr(assistant_service, "chat_reply", lambda *args, **kwargs: {"reply": '{"goal":"Establish conflict","required_beats":["Meet"]}'})
    with Session(control_engine) as session:
        run = seed(session)
        response = service.execute_agent_user_message_run(session, run=run, agent_session_id=run.session_id, message={
            "intent": "chapter.write", "user_message": "Write chapter one",
            "args": {"project_path": str(project), "file_path": str(target), "context_bundle": {"files": []}},
        })
        assert response["agent_result"]["requires_user_confirmation"] is True
        assert response["agent_result"]["confirmation_kind"] == "chapter_brief"
        assert response["agent_result"]["chapter_brief"]["goal"] == "Establish conflict"
        assert "runtime_interruption" not in response
        assert response["agent_result"].get("runtime_interrupted") is not True
        assert run.current_step == "chapter.brief.confirm"
    assert target.read_text(encoding="utf-8") == ""
    persisted = events(control_engine)
    assert persisted[-1].event_type == "agent_execution_settled"
    assert not any(event.event_type == "agent_run_interrupted" for event in persisted)


def test_approve_author_pause_without_permission_cannot_complete_run(control_engine, monkeypatch):
    def run_message(self, session, *, run, **kwargs):
        control(control_engine, "pause_run")
        return result()

    monkeypatch.setattr(AgentRuntime, "run_user_message", run_message)
    with Session(control_engine) as session:
        execute(session, seed(session))
    ack = control(control_engine, "approve_permission")
    assert ack["control_effect"] == "ignored"
    assert ack["run_status"] == "paused"
    assert not any(event.event_type == "agent_run_completed" for event in events(control_engine))
