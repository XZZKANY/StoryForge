from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.event_types import AGENT_PLAN_CREATED, AGENT_RUN_COMPLETED, SYSTEM_JOB, TOOL_TRACE
from app.domains.agent_runs.models import AgentRunEvent
from app.domains.assistant.models import AssistantMessage, AssistantToolCall
from app.platform.ai_sdk import ChatRequest, ChatResponse, TokenUsage, ToolCall


def _message(project_root: Path) -> dict:
    return {
        "type": "user_message",
        "run_id": "terminal-cancellation-run",
        "user_message": "请概括这个小说项目。",
        "intent": "chat.explain",
        "permission_profile": "read",
        "args": {"project_path": str(project_root), "context_bundle": {"files": []}},
    }


def _control(session_factory: sessionmaker[Session], control_type: str) -> service.AgentControlResult:
    with session_factory() as control_session:
        return service.handle_agent_control_message(
            control_session,
            public_id="terminal-cancellation-run",
            session_id="terminal-cancellation-session",
            control_type=control_type,
        )


def _answer() -> ChatResponse:
    return ChatResponse(
        content="late answer",
        usage=TokenUsage(120, 9, 129, source="provider_usage"),
        metadata={"cost_cny_estimated": 0.012},
    )


def _tool_response() -> ChatResponse:
    return ChatResponse(
        content="",
        tool_calls=(ToolCall("list-project", "fs_list", '{"path":"."}'),),
        usage=TokenUsage(80, 7, 87, source="provider_usage"),
        metadata={"cost_cny_estimated": 0.008},
    )


def _provider(
    monkeypatch: pytest.MonkeyPatch, respond: Callable[[int], ChatResponse]
) -> list[ChatRequest]:
    _enable_loop_env(monkeypatch)
    calls: list[ChatRequest] = []

    class Provider:
        def complete(self, request: ChatRequest) -> ChatResponse:
            calls.append(request)
            return respond(len(calls))

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    return calls


def _execute(
    session: Session,
    session_factory: sessionmaker[Session],
    project_root: Path,
    *,
    control_before_execution: str | None = None,
    on_event: Callable[[AgentRunEvent], None] | None = None,
) -> dict:
    message = _message(project_root)
    start = service.start_agent_user_message_run(
        session, agent_session_id="terminal-cancellation-session", message=message
    )
    if control_before_execution is not None:
        _control(session_factory, control_before_execution)
    return service.execute_agent_user_message_run(
        session,
        run=start.run,
        agent_session_id="terminal-cancellation-session",
        message=message,
        on_event=on_event,
    )


def _assert_interrupted(
    session_factory: sessionmaker[Session], result: dict, *, status: str, boundary: str
) -> list[AssistantToolCall]:
    assert result["runtime_interruption"]["status"] == status
    assert result["runtime_interruption"]["boundary"] == boundary
    assert result["agent_result"]["runtime_interrupted"] is True
    assert result["agent_result"]["requires_user_confirmation"] is False
    assert result["proposed_patch"] is None
    assert "late answer" not in json.dumps(result, ensure_ascii=False)
    assert "_runtime_interrupted" not in result
    assert "_events_recorded" not in result
    assert "system_jobs" not in result
    with session_factory() as observed:
        run = service.get_agent_run(observed, "terminal-cancellation-run")
        assert run.status == status
        assert list(observed.scalars(select(AssistantMessage))) == []
        events = list(observed.scalars(select(AgentRunEvent)))
        assert not any(event.event_type in {AGENT_RUN_COMPLETED, SYSTEM_JOB} for event in events)
        assert all("late answer" not in json.dumps(event.payload, ensure_ascii=False) for event in events)
        evidence = list(observed.scalars(select(AssistantToolCall)))
        assert all(
            "late answer" not in json.dumps(item.output_summary, ensure_ascii=False)
            for item in evidence
        )
        return evidence


def _assert_usage(
    evidence: AssistantToolCall,
    *,
    prompt_tokens: int,
    completion_tokens: int,
    cost: float,
    rounds: int,
    tool_calls: int,
) -> None:
    assert evidence.tool_name == "assistant.chat_loop"
    summary = evidence.output_summary
    assert summary["rounds"] == rounds
    assert summary["tool_call_count"] == tool_calls
    assert summary["prompt_tokens"] == prompt_tokens
    assert summary["completion_tokens"] == completion_tokens
    assert summary["token_usage"] == prompt_tokens + completion_tokens
    assert summary["token_usage_source"] == "provider_usage"
    assert summary["cost_cny_estimated"] == pytest.approx(cost)


@pytest.mark.parametrize("control_type,status", [("stop_run", "stopped"), ("pause_run", "paused")])
def test_terminal_answer_respects_control_committed_during_provider_call(
    session: Session,
    session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    control_type: str,
    status: str,
) -> None:
    def respond(round_number: int) -> ChatResponse:
        _control(session_factory, control_type)
        return _answer()

    calls = _provider(monkeypatch, respond)
    result = _execute(session, session_factory, tmp_path)

    assert len(calls) == 1
    evidence = _assert_interrupted(
        session_factory, result, status=status, boundary="before_finalize:assistant.chat_loop"
    )
    assert len(evidence) == 1
    assert evidence[0].status == ("paused" if status == "paused" else "failed")
    _assert_usage(evidence[0], prompt_tokens=120, completion_tokens=9, cost=0.012, rounds=1, tool_calls=0)
    assert evidence[0].output_summary["runtime_interruption"] == result["runtime_interruption"]


def test_uninterrupted_terminal_answer_keeps_messages_completion_and_usage(
    session: Session,
    session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _provider(monkeypatch, lambda round_number: _answer())
    result = _execute(session, session_factory, tmp_path)

    assert len(calls) == 1
    assert "runtime_interruption" not in result
    assert result["agent_result"]["summary"] == "late answer"
    assert "runtime_interrupted" not in result["agent_result"]
    with session_factory() as observed:
        run = service.get_agent_run(observed, "terminal-cancellation-run")
        assert run.status == "completed"
        messages = list(observed.scalars(select(AssistantMessage).order_by(AssistantMessage.id)))
        assert [(message.role, message.content) for message in messages] == [
            ("user", _message(tmp_path)["user_message"]),
            ("assistant", "late answer"),
        ]
        evidence = list(observed.scalars(select(AssistantToolCall)))
        assert len(evidence) == 1
        assert evidence[0].status == "completed"
        _assert_usage(evidence[0], prompt_tokens=120, completion_tokens=9, cost=0.012, rounds=1, tool_calls=0)
        assert "runtime_interruption" not in evidence[0].output_summary
        event_types = list(observed.scalars(select(AgentRunEvent.event_type)))
        assert event_types.count(AGENT_RUN_COMPLETED) == 1
        assert SYSTEM_JOB in event_types
    assert result["agent_result"]["chat_loop"]["assistant_tool_call_id"] == evidence[0].id


@pytest.mark.parametrize("control_type,status", [("stop_run", "stopped"), ("pause_run", "paused")])
def test_terminal_interruption_keeps_previous_tool_audit_and_cumulative_usage(
    session: Session,
    session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    control_type: str,
    status: str,
) -> None:
    (tmp_path / "chapter.md").write_text("第一章。", encoding="utf-8")

    def respond(round_number: int) -> ChatResponse:
        if round_number == 1:
            return _tool_response()
        _control(session_factory, control_type)
        return _answer()

    calls = _provider(monkeypatch, respond)
    result = _execute(session, session_factory, tmp_path)

    assert len(calls) == 2
    assert any(message.role == "tool" and "chapter.md" in (message.content or "") for message in calls[1].messages)
    evidence = _assert_interrupted(
        session_factory, result, status=status, boundary="before_finalize:assistant.chat_loop"
    )
    assert len(evidence) == 2
    by_tool = {item.tool_name: item for item in evidence}
    assert by_tool["fs.list"].status == "completed"
    loop_evidence = by_tool["assistant.chat_loop"]
    assert loop_evidence.status == ("paused" if status == "paused" else "failed")
    _assert_usage(loop_evidence, prompt_tokens=200, completion_tokens=16, cost=0.020, rounds=2, tool_calls=1)
    assert loop_evidence.output_summary["runtime_interruption"] == result["runtime_interruption"]
    assert len(result["tool_trace"]) == 1
    assert result["tool_trace"][0]["tool_name"] == "fs.list"
    assert result["tool_trace"][0]["status"] == "completed"
    assert result["tool_trace"][0]["assistant_tool_call_id"] == by_tool["fs.list"].id
    with session_factory() as observed:
        events = list(observed.scalars(select(AgentRunEvent).where(AgentRunEvent.event_type == TOOL_TRACE)))
        assert len(events) == 1
        assert events[0].payload["trace"]["assistant_tool_call_id"] == by_tool["fs.list"].id


@pytest.mark.parametrize("control_type,status", [("stop_run", "stopped"), ("pause_run", "paused")])
def test_control_before_first_round_makes_no_provider_call_or_usage_evidence(
    session: Session,
    session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    control_type: str,
    status: str,
) -> None:
    calls = _provider(monkeypatch, lambda round_number: pytest.fail("provider must not run"))
    result = _execute(session, session_factory, tmp_path, control_before_execution=control_type)

    assert calls == []
    assert _assert_interrupted(session_factory, result, status=status, boundary="before_round:1") == []
    assert result["tool_trace"] == []


def test_terminal_pause_resume_requires_new_message_without_provider_replay(
    session: Session,
    session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(round_number: int) -> ChatResponse:
        _control(session_factory, "pause_run")
        return _answer()

    calls = _provider(monkeypatch, respond)
    result = _execute(session, session_factory, tmp_path)
    evidence = _assert_interrupted(
        session_factory, result, status="paused", boundary="before_finalize:assistant.chat_loop"
    )
    assert len(evidence) == 1

    resume = _control(session_factory, "resume_run")

    assert resume.resumed_result is None
    assert resume.resume_diagnostic is not None
    assert resume.resume_diagnostic["reason"] == "no_pending_call"
    assert resume.resume_diagnostic["resume_strategy"] == "start_new_message"
    assert resume.resume_diagnostic["reverted_status"] == "stopped"
    assert resume.resume_diagnostic["can_resume"] is False
    assert len(calls) == 1
    with session_factory() as observed:
        assert service.get_agent_run(observed, "terminal-cancellation-run").status == "stopped"
        assert list(observed.scalars(select(AssistantMessage))) == []
        assert list(observed.scalars(select(AssistantToolCall.id))) == [evidence[0].id]


def test_stop_during_plan_recording_replaces_older_before_round_pause_projection(
    session: Session,
    session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _provider(monkeypatch, lambda round_number: pytest.fail("provider must not run"))
    plan_events = []

    def stop_after_plan(event: AgentRunEvent) -> None:
        if event.event_type == AGENT_PLAN_CREATED:
            plan_events.append(event.id)
            _control(session_factory, "stop_run")

    result = _execute(
        session,
        session_factory,
        tmp_path,
        control_before_execution="pause_run",
        on_event=stop_after_plan,
    )

    assert calls == []
    assert len(plan_events) == 1
    assert _assert_interrupted(
        session_factory, result, status="stopped", boundary="before_finalize:assistant.chat_loop"
    ) == []


@pytest.mark.parametrize("control_type,status", [("stop_run", "stopped"), ("pause_run", "paused")])
def test_before_second_round_interruption_retains_first_round_usage_and_boundary(
    session: Session,
    session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    control_type: str,
    status: str,
) -> None:
    calls = _provider(monkeypatch, lambda round_number: _tool_response())

    def interrupt_after_trace(event: AgentRunEvent) -> None:
        if event.event_type == TOOL_TRACE:
            _control(session_factory, control_type)

    result = _execute(session, session_factory, tmp_path, on_event=interrupt_after_trace)

    assert len(calls) == 1
    evidence = _assert_interrupted(session_factory, result, status=status, boundary="before_round:2")
    assert len(evidence) == 2
    by_tool = {item.tool_name: item for item in evidence}
    assert by_tool["fs.list"].status == "completed"
    loop_evidence = by_tool["assistant.chat_loop"]
    assert loop_evidence.status == ("paused" if status == "paused" else "failed")
    _assert_usage(loop_evidence, prompt_tokens=80, completion_tokens=7, cost=0.008, rounds=1, tool_calls=1)
    assert loop_evidence.output_summary["runtime_interruption"] == result["runtime_interruption"]
