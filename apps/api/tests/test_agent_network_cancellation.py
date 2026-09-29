from __future__ import annotations

import io
import json
from email.message import Message
from urllib.error import HTTPError

import pytest
from sqlalchemy import select

from app.common import llm_client
from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.loop import run_control
from app.domains.agent_runs.models import AgentRunEvent
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantToolCall


class JsonResponse:
    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.data).encode()


def model_response(tool=None):
    message = {"role": "assistant", "content": "" if tool else "answer"}
    if tool:
        message["tool_calls"] = [{"id": "call-1", "type": "function", "function": tool}]
    return {
        "choices": [{"message": message, "finish_reason": "tool_calls" if tool else "stop"}],
        "usage": {"prompt_tokens": 20, "completion_tokens": 7, "total_tokens": 27},
    }


def setup_run(monkeypatch, tmp_path, session_factory, *, stop_type="stop_run", deadline=False, cancel_on_wait=True):
    env = {"STORYFORGE_LLM_MODEL": "fixture", "STORYFORGE_LLM_PROVIDER": "openai",
           "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1", "STORYFORGE_LLM_API_KEY": "fixture-key"}
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: env)
    manuscript = tmp_path / "chapter.md"
    manuscript.write_text("必须保留的原文。", encoding="utf-8")
    clock, waits, controls = [0.0], [], []
    original_factory = run_control.build_run_control

    def make_control(context, *, duration_seconds):
        control = original_factory(context, duration_seconds=duration_seconds)
        control.clock = lambda: clock[0]
        control.deadline = 0.05 if deadline else 900.0

        def wait(seconds):
            waits.append(seconds)
            clock[0] += seconds
            if not deadline and cancel_on_wait:
                with session_factory() as control_session:
                    service.handle_agent_control_message(control_session, public_id="network-control",
                                                         session_id="network-session", control_type=stop_type)

        control.wait = wait
        controls.append(control)
        return control

    monkeypatch.setattr(run_control, "build_run_control", make_control)
    return manuscript, clock, waits, controls


def execute(session, tmp_path, *, project=True, run_id="network-control", intent="chat.explain", on_event=None):
    message = {"type": "user_message", "run_id": run_id, "user_message": "检查并修订正文",
               "intent": intent, "permission_profile": "ask",
               "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}}}
    if not project:
        message["args"].pop("project_path")
    if intent in {"file.revise", "chapter.write"}:
        message["args"].update(file_path=str(tmp_path / "chapter.md"), content="必须保留的原文。")
    start = service.start_agent_user_message_run(session, agent_session_id="network-session", message=message)
    return service.execute_agent_user_message_run(session, run=start.run,
                                                 agent_session_id="network-session", message=message, on_event=on_event)


def throttle():
    headers = Message()
    headers["Retry-After"] = "1"
    return HTTPError("https://fixture.invalid", 429, "synthetic throttle", headers, io.BytesIO(b"{}"))


@pytest.mark.parametrize("nested", [False, True])
@pytest.mark.parametrize("stop_type,status", [("stop_run", "stopped"), ("pause_run", "paused")])
def test_live_model_and_nested_revision_retry_wait_are_cancelled(
    session, session_factory, tmp_path, monkeypatch, nested, stop_type, status,
):
    manuscript, clock, waits, controls = setup_run(monkeypatch, tmp_path, session_factory, stop_type=stop_type)
    requests = []

    def urlopen(request, *, timeout):
        requests.append(json.loads(request.data))
        if nested and len(requests) == 1:
            return JsonResponse(model_response({"name": "file_revise", "arguments": json.dumps({
                "path": "chapter.md", "instruction": "只修改标点"})}))
        assert len(requests) == (2 if nested else 1), "cancelled request must not retry"
        raise throttle()

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path)
    assert len(requests) == (2 if nested else 1)
    assert waits and len(controls) == 1
    assert result["runtime_interruption"]["status"] == status
    assert result["runtime_interruption"]["boundary"] == "retry_wait"
    assert result["agent_result"]["runtime_interrupted"] is True
    assert result["proposed_patch"] is None
    assert manuscript.read_text(encoding="utf8") == "必须保留的原文。"
    with session_factory() as observed:
        assert service.get_agent_run(observed, "network-control").status == status
        evidence = list(observed.scalars(select(AssistantToolCall)))
        assert all(item.status != "running" for item in evidence)
        if nested:
            for name in ("assistant.revise", "file.revise"):
                item = next(item for item in evidence if item.tool_name == name)
                assert item.status == "paused"
                assert item.output_summary["execution_state"] == "unknown"
        aggregate = next(item for item in evidence if item.tool_name == "assistant.chat_loop")
        assert aggregate.output_summary["token_usage"] == (27 if nested else 0)
        assert not any(event.event_type in {"agent_run_completed", "permission_required"}
                       for event in observed.scalars(select(AgentRunEvent)))


def test_deadline_after_complete_keeps_usage_but_dispatches_no_tool(session, session_factory, tmp_path, monkeypatch):
    manuscript, clock, waits, controls = setup_run(monkeypatch, tmp_path, session_factory, deadline=True)
    requests = []

    def urlopen(request, *, timeout):
        requests.append(timeout)
        clock[0] = 1.0
        return JsonResponse(model_response({"name": "fs_read", "arguments": '{"path":"chapter.md"}'}))

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path)
    assert requests == [pytest.approx(0.05)]
    assert not waits
    assert "runtime_interruption" not in result
    assert result["agent_result"]["execution_outcome"]["code"] == "runtime_deadline"
    assert result["proposed_patch"] is None
    assert result["tool_trace"] == []
    with session_factory() as observed:
        assert service.get_agent_run(observed, "network-control").status == "failed"
        evidence = list(observed.scalars(select(AssistantToolCall)))
        aggregate = next(item for item in evidence if item.tool_name == "assistant.chat_loop")
        assert aggregate.output_summary["token_usage"] == 27


def test_deadline_during_nested_retry_is_not_a_user_stop(session, session_factory, tmp_path, monkeypatch):
    manuscript, clock, waits, controls = setup_run(monkeypatch, tmp_path, session_factory, deadline=True)
    requests = []

    def urlopen(request, *, timeout):
        requests.append(timeout)
        if len(requests) == 1:
            return JsonResponse(model_response({"name": "file_revise", "arguments": json.dumps({
                "path": "chapter.md", "instruction": "只修改标点"})}))
        assert len(requests) == 2
        raise throttle()

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path)
    assert len(requests) == 2 and waits
    assert "runtime_interruption" not in result
    assert result["agent_result"]["execution_outcome"]["code"] == "runtime_deadline"
    assert result["proposed_patch"] is None
    with session_factory() as observed:
        assert service.get_agent_run(observed, "network-control").status == "failed"
        assert all(item.status != "running" for item in observed.scalars(select(AssistantToolCall)))


@pytest.mark.parametrize("origin", ["unsupported", "no_project"])
@pytest.mark.parametrize("phase", ["retry", "completed"])
@pytest.mark.parametrize("reason", ["stop_run", "pause_run", "deadline"])
def test_fallback_uses_same_scope_and_never_delivers_after_control(
    session, session_factory, tmp_path, monkeypatch, origin, phase, reason,
):
    from app.common.llm_control import has_run_control
    from app.platform.ai_sdk import ProviderError, ProviderErrorCategory, ProviderErrorDetails

    deadline = reason == "deadline"
    manuscript, clock, waits, controls = setup_run(
        monkeypatch, tmp_path, session_factory, stop_type=reason, deadline=deadline,
    )
    planner_calls, requests = [], []

    class UnsupportedProvider:
        def complete(self, request):
            planner_calls.append(request)
            clock[0] = 0.02
            raise ProviderError(ProviderErrorDetails(ProviderErrorCategory.UNSUPPORTED, "no tools"))

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: UnsupportedProvider())

    def interrupt():
        if deadline:
            clock[0] = 1.0
        else:
            with session_factory() as other:
                service.handle_agent_control_message(
                    other, public_id="network-control", session_id="network-session", control_type=reason,
                )

    def urlopen(request, *, timeout):
        requests.append(timeout)
        assert len(requests) == 1, "fallback must not dispatch after stop/deadline"
        assert has_run_control(), "fallback escaped the live run scope"
        if phase == "retry":
            raise throttle()
        interrupt()
        return JsonResponse(model_response())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path, project=origin == "unsupported")
    assert len(planner_calls) == (1 if origin == "unsupported" else 0)
    assert len(controls) == 1 and len(requests) == 1
    if deadline:
        assert requests[0] == pytest.approx(0.03 if origin == "unsupported" else 0.05)
        assert result["agent_result"]["execution_outcome"]["code"] == "runtime_deadline"
        expected_status = "failed"
    else:
        expected_status = "stopped" if reason == "stop_run" else "paused"
        assert result["runtime_interruption"]["status"] == expected_status
        assert result["agent_result"]["runtime_interrupted"] is True
    assert result["proposed_patch"] is None
    assert not has_run_control(), "scope must be reset after normal/exceptional exits"
    assert manuscript.read_text(encoding="utf8") == "必须保留的原文。"
    with session_factory() as observed:
        assert service.get_agent_run(observed, "network-control").status == expected_status
        assert not assistant_service.get_assistant_session(observed, result["assistant_session_id"]).messages
        evidence = list(observed.scalars(select(AssistantToolCall)))
        assert all(item.status != "running" for item in evidence)
        chat = next(item for item in evidence if item.tool_name == "assistant.chat")
        if phase == "completed":
            assert chat.output_summary["token_usage"] == 27
        else:
            assert chat.output_summary["execution_state"] == "unknown"
        assert not any(event.event_type in {"agent_run_completed", "permission_required", "system_job"}
                       for event in observed.scalars(select(AgentRunEvent)))


@pytest.mark.parametrize("reason", ["stop_run", "pause_run", "deadline"])
def test_fixed_revision_retry_uses_run_scope(session, session_factory, tmp_path, monkeypatch, reason):
    from app.common.llm_control import has_run_control

    setup_run(monkeypatch, tmp_path, session_factory, stop_type=reason, deadline=reason == "deadline")
    requests = []

    def urlopen(request, *, timeout):
        requests.append(timeout)
        assert len(requests) == 1
        assert has_run_control(), "fixed intent must share the same cancellation boundary"
        raise throttle()

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path, intent="file.revise")
    assert len(requests) == 1
    assert not has_run_control()
    assert result["proposed_patch"] is None
    if reason == "deadline":
        assert result["agent_result"]["execution_outcome"]["code"] == "runtime_deadline"
    else:
        assert result["runtime_interruption"]["status"] == ("stopped" if reason == "stop_run" else "paused")
    with session_factory() as observed:
        assert all(item.status != "running" for item in observed.scalars(select(AssistantToolCall)))


def test_control_scope_restores_parent_and_next_run_is_not_cancelled(
    session, session_factory, tmp_path, monkeypatch,
):
    from app.common.llm_control import LLMRunControl, has_run_control, llm_run_control, request_timeout

    manuscript, clock, waits, controls = setup_run(monkeypatch, tmp_path, session_factory)
    requests = []

    def urlopen(request, *, timeout):
        requests.append(request)
        if len(requests) == 1:
            raise throttle()
        return JsonResponse(model_response())

    parent_events = []
    parent = LLMRunControl(lambda boundary: None, on_progress=parent_events.append)
    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    with llm_run_control(parent):
        first = execute(session, tmp_path, project=False)
        assert first["runtime_interruption"]["status"] == "stopped"
        assert has_run_control() and not parent_events
        assert request_timeout(12.0) == 12.0
        assert parent_events[-1]["phase"] == "request_started"
        second = execute(session, tmp_path, project=False, run_id="next-clean-run")
        assert second["agent_result"]["summary"] == "answer"
        assert "runtime_interruption" not in second
        assert "execution_outcome" not in second["agent_result"]
    assert len(controls) == 2 and controls[0] is not controls[1]
    assert len(requests) == 2
    assert not has_run_control()
    assert service.get_agent_run(session, "next-clean-run").status == "completed"


def test_exception_exit_restores_scope_before_next_run(session, session_factory, tmp_path, monkeypatch):
    from app.common.llm_control import has_run_control

    setup_run(monkeypatch, tmp_path, session_factory)
    original = assistant_service.chat_reply

    def programming_error(*args, **kwargs):
        assert has_run_control()
        raise RuntimeError("synthetic programming error")

    monkeypatch.setattr(assistant_service, "chat_reply", programming_error)
    with pytest.raises(service.AgentRuntimeError, match="synthetic programming error"):
        execute(session, tmp_path, project=False)
    assert not has_run_control()
    monkeypatch.setattr(assistant_service, "chat_reply", original)
    monkeypatch.setattr(llm_client.request, "urlopen", lambda request, *, timeout: JsonResponse(model_response()))
    result = execute(session, tmp_path, project=False, run_id="after-fault")
    assert result["agent_result"]["summary"] == "answer"
    assert not has_run_control()


@pytest.mark.parametrize("project", [False, True])
def test_fallback_provider_failure_is_not_completed(session, session_factory, tmp_path, monkeypatch, project):
    from app.platform.ai_sdk import ProviderError, ProviderErrorCategory, ProviderErrorDetails

    setup_run(monkeypatch, tmp_path, session_factory)

    class UnsupportedProvider:
        def complete(self, request):
            raise ProviderError(ProviderErrorDetails(ProviderErrorCategory.UNSUPPORTED, "no tools"))

    def urlopen(request, *, timeout):
        raise HTTPError("https://fixture.invalid", 401, "synthetic auth", Message(), io.BytesIO(b"{}"))

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: UnsupportedProvider())
    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path, project=project)
    assert result["agent_result"]["execution_outcome"]["code"] == "provider_error"
    assert service.get_agent_run(session, "network-control").status == "failed"
    events = list(session.scalars(select(AgentRunEvent)))
    assert not any(event.event_type in {"agent_run_completed", "system_job"} for event in events)
    failure = next(event for event in events if event.event_type == "agent_run_failed")
    assert failure.payload["execution_result"] == result


def test_retry_progress_is_durable_and_encoded_from_real_transport(
    session, session_factory, tmp_path, monkeypatch,
):
    from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event

    setup_run(monkeypatch, tmp_path, session_factory, cancel_on_wait=False)
    requests, live = [], []

    def urlopen(request, *, timeout):
        requests.append(timeout)
        if len(requests) == 1:
            raise throttle()
        return JsonResponse(model_response())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path, on_event=live.append)
    assert result["agent_result"]["summary"] == "answer"
    progress = [event for event in live if event.event_type == "agent_runtime_progress"]
    assert [event.payload["phase"] for event in progress] == [
        "request_started", "retry_wait", "retry_started", "request_started",
    ]
    assert [event.payload["request_number"] for event in progress] == [1, 1, 1, 2]
    persisted = list(session.scalars(select(AgentRunEvent).where(
        AgentRunEvent.event_type == "agent_runtime_progress").order_by(AgentRunEvent.sequence)))
    assert [event.id for event in persisted] == [event.id for event in progress]
    for event in progress:
        assert set(event.payload) <= {"phase", "request_number", "delay_seconds", "timeout_seconds"}
        frame, = websocket_stream_events_from_agent_event(event)
        assert frame["type"] == "agent_step" and frame["step"] == "agent.provider"
        assert frame["index"] == -1 and frame["status"] == "running"
        assert frame["detail"]
        assert "fixture-key" not in json.dumps(frame)
    assert len(requests) == 2


def test_progress_normalization_drops_non_metadata_and_rejects_invalid_numbers():
    from app.domains.agent_runs.runtime_progress import normalize_runtime_progress

    assert normalize_runtime_progress({
        "phase": "request_started", "request_number": 2, "timeout_seconds": 3.0,
        "prompt": "must not persist", "api_key": "fixture-key", "error": "private text",
    }) == {"phase": "request_started", "request_number": 2, "timeout_seconds": 3.0}
    for invalid in (True, -1, float("inf"), float("nan"), "3"):
        with pytest.raises(ValueError):
            normalize_runtime_progress({"phase": "retry_wait", "request_number": 1, "delay_seconds": invalid})


@pytest.mark.parametrize("reason", ["stop_run", "pause_run", "deadline"])
def test_completed_chapter_brief_is_evidence_not_late_confirmation(
    session, session_factory, tmp_path, monkeypatch, reason,
):
    from app.domains.agent_runs.adapters.chapter_writing_contracts import CHAPTER_BRIEF_ARTIFACT_KIND
    from app.domains.agent_runs.models import AgentArtifact

    manuscript, clock, waits, controls = setup_run(
        monkeypatch, tmp_path, session_factory, stop_type=reason, deadline=reason == "deadline",
    )
    manuscript.write_text("", encoding="utf8")

    def urlopen(request, *, timeout):
        if reason == "deadline":
            clock[0] = 1.0
        else:
            with session_factory() as other:
                service.handle_agent_control_message(
                    other, public_id="network-control", session_id="network-session", control_type=reason,
                )
        data = model_response()
        data["choices"][0]["message"]["content"] = '{"goal":"建立冲突","required_beats":["见面"]}'
        return JsonResponse(data)

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path, intent="chapter.write")
    assert result["proposed_patch"] is None
    assert result["agent_result"]["requires_user_confirmation"] is False
    assert "confirmation_action" not in result["agent_result"]
    assert result["agent_result"]["chapter_brief"]["goal"] == "建立冲突"
    if reason == "deadline":
        assert result["agent_result"]["execution_outcome"]["status"] == "partial"
        assert result["agent_result"]["execution_outcome"]["code"] == "runtime_deadline"
        expected_status = "failed"
    else:
        expected_status = "stopped" if reason == "stop_run" else "paused"
        assert result["runtime_interruption"]["status"] == expected_status
    with session_factory() as observed:
        assert service.get_agent_run(observed, "network-control").status == expected_status
        assert not assistant_service.get_assistant_session(observed, result["assistant_session_id"]).messages
        brief = observed.scalar(select(AgentArtifact).where(AgentArtifact.kind == CHAPTER_BRIEF_ARTIFACT_KIND))
        assert brief.payload["goal"] == "建立冲突" and brief.payload["status"] == "interrupted"
        assert brief.requires_confirmation is False
        evidence = observed.scalar(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.chat"))
        assert evidence.output_summary["token_usage"] == 27
        assert not any(event.event_type in {"permission_required", "agent_run_completed", "system_job"}
                       for event in observed.scalars(select(AgentRunEvent)))
    assert manuscript.read_text(encoding="utf8") == ""
