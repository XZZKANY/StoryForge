from __future__ import annotations

import pytest
from sqlalchemy import select

from app.common.llm_control import has_run_control
from app.domains.agent_runs import service
from app.domains.agent_runs.loop import run_control
from app.domains.agent_runs.models import AgentArtifact, AgentRunEvent
from app.domains.assistant import service as assistant_service
from app.domains.ide import review_reasoning


@pytest.mark.parametrize("branch", ["fresh", "resume_context", "resume_postprocess"])
@pytest.mark.parametrize("reason", ["stop_run", "pause_run", "deadline"])
def test_completed_review_is_preserved_without_late_success_messages(
    session, session_factory, monkeypatch, branch, reason,
):
    state = {"stage": 0 if branch != "fresh" else 1, "clock": 0.0, "triggered": False}
    model_calls = []
    run_id, session_id = "review-delivery", "review-session"
    original_factory = run_control.build_run_control
    original_record = service.record_agent_event

    def make_control(context, *, duration_seconds):
        control = original_factory(context, duration_seconds=duration_seconds)
        control.clock = lambda: state["clock"]
        control.deadline = 10.0
        return control

    def control(kind):
        with session_factory() as other:
            service.record_agent_control_event(
                other, public_id=run_id, session_id=session_id, control_type=kind,
            )

    def interrupt():
        assert not state["triggered"]
        state["triggered"] = True
        if reason == "deadline":
            state["clock"] = 11.0
        else:
            control(reason)

    def record_event(db, run, **kwargs):
        event = original_record(db, run, **kwargs)
        trace = kwargs.get("payload", {}).get("trace", {})
        name = trace.get("tool_name")
        if kwargs.get("event_type") == "tool_trace":
            initial_boundary = "context.load" if branch == "resume_context" else "subagent.plot_reviewer"
            if state["stage"] == 0 and name == initial_boundary:
                state["stage"] = -1
                control("pause_run")
            elif state["stage"] == 1 and branch == "resume_postprocess" and not state["triggered"]:
                interrupt()
        return event

    def model(source, **kwargs):
        model_calls.append(kwargs)
        assert has_run_control()
        if state["stage"] == 1 and branch != "resume_postprocess" and len(model_calls) % 3 == 0:
            interrupt()
        return {"content": "[]", "latency_ms": 1, "token_usage": 7}

    monkeypatch.setattr(run_control, "build_run_control", make_control)
    monkeypatch.setattr(service, "record_agent_event", record_event)
    monkeypatch.setattr(review_reasoning, "missing_llm_env", lambda: [])
    monkeypatch.setattr(review_reasoning, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fixture"})
    monkeypatch.setattr(review_reasoning, "_call_llm", model)
    message = {
        "type": "user_message", "run_id": run_id, "user_message": "Review this chapter",
        "intent": "file.review", "permission_profile": "ask",
        "args": {"file_path": "chapter.md", "content": "The lamp went out.", "context_bundle": {"files": []}},
    }
    start = service.start_agent_user_message_run(session, agent_session_id=session_id, message=message)

    def execute():
        return service.execute_agent_user_message_run(
            session, run=start.run, agent_session_id=session_id, message=message,
        )

    if branch != "fresh":
        first = execute()
        assert first["runtime_interruption"]["status"] == "paused"
        message["assistant_session_id"] = first["assistant_session_id"]
        state["stage"] = 1
        control("resume_run")
        session.refresh(start.run)
    result = execute()
    assert state["triggered"]
    assert len(model_calls) == 3
    assert not has_run_control()
    assert result["proposed_patch"] is None
    assert result["agent_result"]["review_report"]["mode"] == "llm"
    assert len(result["tool_trace"]) == 6
    with session_factory() as observed:
        messages = assistant_service.get_assistant_session(observed, result["assistant_session_id"]).messages
        assert messages == [], "cancelled review must not pollute later conversation history"
        events = list(observed.scalars(select(AgentRunEvent).order_by(AgentRunEvent.id)))
        assert not any(event.event_type == "agent_run_completed" for event in events)
        artifacts = list(observed.scalars(select(AgentArtifact).order_by(AgentArtifact.id)))
        if reason == "deadline":
            assert service.get_agent_run(observed, run_id).status == "failed"
            assert result["agent_result"]["execution_outcome"]["code"] == "runtime_deadline"
            assert result["agent_result"]["execution_outcome"]["status"] == "partial"
            assert "runtime_interruption" not in result
        else:
            expected = "paused" if reason == "pause_run" else "stopped"
            assert result["runtime_interruption"]["status"] == expected
            assert service.get_agent_run(observed, run_id).status == expected
        if reason == "pause_run":
            pending = [item for item in artifacts if item.kind == "runtime_pending_call"][-1]
            assert pending.payload["review_output"]["review_report"] == result["agent_result"]["review_report"]
            assert len(pending.payload["review_output"]["traces"]) == 5
        else:
            reports = [item for item in artifacts if item.kind == "review_report"]
            assert reports[-1].payload == result["agent_result"]["review_report"]
            names = [event.payload["trace"]["tool_name"] for event in events if event.event_type == "tool_trace"]
            assert names == [trace["tool_name"] for trace in result["tool_trace"]]

    if reason == "pause_run":
        state["stage"] = 2
        message["assistant_session_id"] = result["assistant_session_id"]
        control("resume_run")
        session.refresh(start.run)
        resumed = execute()
        assert len(model_calls) == 3, "completed reviewers must not be replayed"
        assert service.get_agent_run(session, run_id).status == "completed"
        assert "runtime_interruption" not in resumed
        session.expire_all()
        messages = assistant_service.get_assistant_session(session, result["assistant_session_id"]).messages
        assert [item.role for item in messages] == ["user", "assistant"]
