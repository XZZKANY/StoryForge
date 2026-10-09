"""Durable delivery under disconnects and competing control transactions."""

from __future__ import annotations

import pytest
from agent_transport import control_agent, parse_agent_sse
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from app.db.base import Base
from app.domains.agent_runs import service, service_control
from app.domains.assistant import service as assistant_service


@pytest.fixture
def engine(tmp_path):
    db = create_engine(
        f"sqlite:///{tmp_path / 'capture.sqlite'}", poolclass=NullPool, connect_args={"check_same_thread": False}
    )
    with db.begin() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    yield db
    db.dispose()


def capture(client, _name, session_id, run_id, *, frames=None, stream_text=None, **extras):
    response = client.get(f"/api/agent-runs/{run_id}/events")
    assert response.status_code == 200
    data = {
        "session_id": session_id,
        "run_id": run_id,
        "frames": frames,
        "stream_text": stream_text,
        "events": response.json(),
        "run": client.get(f"/api/agent-runs/{run_id}").json(),
        "artifacts": client.get(f"/api/agent-runs/{run_id}/artifacts").json(),
        **extras,
    }
    return data


@pytest.mark.parametrize("control_type", [None, "stop_run", "pause_run"])
def test_revision_delivery_capture(client, monkeypatch, session_factory, tmp_path, control_type):
    session_id, run_id = "audit-revision-session", "audit-revision-run"
    original = "林岚走进港口，停在熄灭的灯塔前。\n"
    target = tmp_path / "chapter.md"
    target.write_text(original, encoding="utf-8")
    calls, controls = [], []
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def generate(*_args, **_kwargs):
        calls.append(True)
        if control_type:
            with session_factory() as session:
                control = service.handle_agent_control_message(
                    session, public_id=run_id, session_id=session_id, control_type=control_type
                )
                controls.append(service.websocket_control_event(control.event))
        return {"content": "林岚踏进港口，在熄灭的灯塔前停下。\n", "completion_tokens": 8, "latency_ms": 1}

    monkeypatch.setattr(assistant_service, "_call_llm", generate)
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", generate)
    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={
            "run_id": run_id,
            "user_message": "把这一段改得更紧凑",
            "intent": "file.revise",
            "permission_profile": "ask",
            "args": {
                "project_path": str(tmp_path),
                "file_path": str(target),
                "content": original,
                "context_bundle": {"files": []},
            },
        },
    )
    assert response.status_code == 200
    frames = parse_agent_sse(response.text)
    assert calls == [True]
    assert target.read_text(encoding="utf-8") == original
    case = control_type or "pending"
    data = capture(
        client, "revision-" + case, session_id, run_id, frames=frames, stream_text=response.text, controls=controls
    )
    assert all(frame.get("run_id") == run_id for frame in frames)
    if control_type:
        assert frames[-1]["runtime_interruption"]["status"] == ("stopped" if control_type == "stop_run" else "paused")
        assert frames[-1]["proposed_patch"] is None
        assert not any(
            event["event_type"] in {"permission_required", "agent_run_completed"} for event in data["events"]
        )
        repeated = control_agent(client, session_id, control_type=control_type, run_id=run_id)
        capture(client, "revision-" + case + "-repeated", session_id, run_id, controls=controls + [repeated])
    else:
        patch = frames[-1]["proposed_patch"]
        assert patch["requires_confirmation"] is True
        assert data["run"]["status"] == "paused"
        assert (
            next(e for e in data["events"] if e["event_type"] == "permission_required")["payload"]["proposed_patch"]
            == patch
        )
        for _ in range(2):
            assert client.get(f"/api/agent-runs/{run_id}/events").json() == data["events"]
        approved = control_agent(client, session_id, control_type="approve_permission", run_id=run_id)
        first = capture(client, "revision-approved", session_id, run_id, controls=[approved])
        repeated = control_agent(client, session_id, control_type="approve_permission", run_id=run_id)
        second = capture(client, "revision-approved-repeated", session_id, run_id, controls=[approved, repeated])
        assert first["run"]["status"] == second["run"]["status"] == "completed"
        assert sum(e["event_type"] == "agent_run_completed" for e in second["events"]) == 1
        assert repeated["control_effect"] == "ignored"


def test_chat_pause_resume_capture(client, monkeypatch, session_factory, tmp_path):
    from agent_loop_runtime_test_support import _enable_loop_env

    from app.domains.agent_runs import loop_runtime
    from app.platform.ai_sdk import ChatResponse, ProviderCapabilities

    session_id, run_id = "audit-resume-session", "audit-resume-run"
    calls, controls = [], []
    _enable_loop_env(monkeypatch)

    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=False)

        def complete(self, request):
            calls.append(request)
            with session_factory() as session:
                control = service.handle_agent_control_message(
                    session, public_id=run_id, session_id=session_id, control_type="pause_run"
                )
                controls.append(service.websocket_control_event(control.event))
            return ChatResponse(content="准备好的完整答复。")

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={
            "run_id": run_id,
            "user_message": "概括这个小说项目",
            "permission_profile": "read",
            "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
        },
    )
    frames = parse_agent_sse(response.text)
    assert frames[-1]["runtime_interruption"]["status"] == "paused"
    capture(client, "chat-paused", session_id, run_id, frames=frames, stream_text=response.text, controls=controls)
    ack = control_agent(client, session_id, control_type="resume_run", run_id=run_id)
    assert ack["resumed_result"]["run_id"] == run_id
    assert ack["resumed_result"]["agent_result"]["summary"] == "准备好的完整答复。"
    capture(client, "chat-resumed", session_id, run_id, controls=controls + [ack])
    duplicate = control_agent(client, session_id, control_type="resume_run", run_id=run_id)
    data = capture(client, "chat-resumed-repeated", session_id, run_id, controls=controls + [ack, duplicate])
    assert duplicate["control_effect"] == "ignored"
    assert len(calls) == 1
    assert sum(e["event_type"] == "agent_run_completed" for e in data["events"]) == 1


def test_real_worker_disconnect_preserves_pending_proposal(client, monkeypatch, session_factory, tmp_path):
    import asyncio
    import threading

    from starlette.responses import StreamingResponse

    from app.domains.ide import router as ide_router
    from app.domains.ide import stream_measurement

    session_id, run_id = "audit-disconnect-session", "audit-disconnect-run"
    entered, release, finished, transport_finished = (threading.Event() for _ in range(4))
    received, reports, calls = [], [], []
    original = "林岚在灯塔前等待。\n"
    target = tmp_path / "chapter.md"
    target.write_text(original, encoding="utf-8")
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])

    def generate(*args, **kwargs):
        calls.append(True)
        entered.set()
        assert release.wait(timeout=10)
        return {"content": "林岚守在灯塔前。\n", "completion_tokens": 8, "latency_ms": 1}

    def log(report):
        reports.append(report)
        if report["phase"] == "worker_finished":
            finished.set()
        if report["phase"] == "transport_finished":
            transport_finished.set()

    monkeypatch.setattr(assistant_service, "_call_llm", generate)
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", generate)
    monkeypatch.setattr(stream_measurement, "log_measurement", log)
    message = {
        "type": "user_message",
        "stream": True,
        "run_id": run_id,
        "user_message": "精简这段",
        "intent": "file.revise",
        "permission_profile": "ask",
        "args": {
            "project_path": str(tmp_path),
            "file_path": str(target),
            "content": original,
            "context_bundle": {"files": []},
        },
    }

    async def exercise():
        first_body = asyncio.Event()

        async def send(value):
            if value.get("type") == "http.response.body" and value.get("body"):
                received.append(value["body"].decode())
                first_body.set()

        async def receive():
            await first_body.wait()
            return {"type": "http.disconnect"}

        with session_factory() as session:
            frames = ide_router._agent_user_message_sse(session, session_id=session_id, message=message)
            response = StreamingResponse(frames, media_type="text/event-stream")
            task = asyncio.create_task(response({"type": "http", "asgi": {"spec_version": "2.3"}}, receive, send))
            try:
                assert await asyncio.to_thread(entered.wait, 5)
                assert await asyncio.to_thread(transport_finished.wait, 5)
                assert not finished.is_set()
                before = await asyncio.to_thread(
                    capture,
                    client,
                    "revision-disconnected-in-flight",
                    session_id,
                    run_id,
                    stream_text="".join(received),
                    frames=parse_agent_sse("".join(received)),
                )
                assert before["run"]["status"] == "running"
                assert not any(
                    e["event_type"] in {"permission_required", "agent_run_completed"} for e in before["events"]
                )
            finally:
                release.set()
                assert await asyncio.to_thread(finished.wait, 5)
                await task
                await frames.aclose()

    asyncio.run(exercise())
    data = capture(
        client,
        "revision-disconnected-settled",
        session_id,
        run_id,
        stream_text="".join(received),
        frames=parse_agent_sse("".join(received)),
    )
    assert calls == [True]
    assert data["run"]["status"] == "paused"
    permission = next(e for e in data["events"] if e["event_type"] == "permission_required")
    assert permission["payload"]["proposed_patch"]["requires_confirmation"] is True
    assert target.read_text(encoding="utf-8") == original
    assert not any(
        e["event_type"] in {"stop_run", "agent_run_completed", "agent_run_interrupted"} for e in data["events"]
    )
    assert all(f["type"] != "agent_result" for f in data["frames"])


def test_stop_winning_during_permission_resolution_cannot_be_overwritten(
    client, monkeypatch, session_factory, tmp_path
):
    from app.domains.agent_runs import service_control

    session_id, run_id = "audit-permission-race-session", "audit-permission-race-run"
    original = "林岚走进港口。"
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        assistant_service,
        "_call_llm_streamed",
        lambda *_a, **_k: {"content": "林岚踏进港口。", "completion_tokens": 8, "latency_ms": 1},
    )
    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={
            "run_id": run_id,
            "user_message": "精简这段",
            "intent": "file.revise",
            "permission_profile": "ask",
            "args": {"file_path": str(tmp_path / "chapter.md"), "content": original},
        },
    )
    frames = parse_agent_sse(response.text)
    assert frames[-1]["proposed_patch"]["requires_confirmation"] is True
    resolve = service_control.resolve_execution_result
    stop_acks = []

    def interleave_stop(payload, *, approved):
        with session_factory() as session:
            stopped = service.handle_agent_control_message(
                session, public_id=run_id, session_id=session_id, control_type="stop_run"
            )
            stop_acks.append(service.websocket_control_event(stopped.event))
        return resolve(payload, approved=approved)

    monkeypatch.setattr(service_control, "resolve_execution_result", interleave_stop)
    approved = control_agent(client, session_id, control_type="approve_permission", run_id=run_id)
    assert stop_acks[0]["control_effect"] == "applied"
    assert stop_acks[0]["run_status"] == "stopped"
    data = capture(
        client,
        "permission-stop-race",
        session_id,
        run_id,
        frames=frames,
        stream_text=response.text,
        controls=stop_acks + [approved],
    )
    assert data["run"]["status"] == "stopped"
    assert not any(e["event_type"] == "agent_run_completed" for e in data["events"])


def test_stop_before_completion_update_cannot_be_overwritten(client, monkeypatch, session_factory, engine, tmp_path):
    from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
    from sqlalchemy import event

    session_id, run_id = "audit-completion-race-session", "audit-completion-race-run"
    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(monkeypatch, [{"content": "已完成的答复。", "tool_calls": []}])
    stop_acks = []

    def before_update(connection, cursor, statement, parameters, context, executemany):
        if not stop_acks and statement.startswith("UPDATE agent_runs SET status=") and "completed" in parameters:
            # Mark before nested stop so its own SQL cannot trigger another control.
            stop_acks.append(None)
            with session_factory() as session:
                stopped = service.handle_agent_control_message(
                    session, public_id=run_id, session_id=session_id, control_type="stop_run"
                )
                stop_acks[0] = service.websocket_control_event(stopped.event)

    event.listen(engine, "before_cursor_execute", before_update)
    try:
        response = client.post(
            f"/api/ide/agent/sessions/{session_id}/stream",
            json={
                "run_id": run_id,
                "user_message": "概括这个项目",
                "permission_profile": "read",
                "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
            },
        )
    finally:
        event.remove(engine, "before_cursor_execute", before_update)
    assert len(calls) == 1
    assert stop_acks and stop_acks[0]["run_status"] == "stopped"
    assert stop_acks[0]["control_effect"] == "requested"
    data = capture(
        client,
        "completion-stop-race",
        session_id,
        run_id,
        frames=parse_agent_sse(response.text),
        stream_text=response.text,
        controls=stop_acks,
    )
    assert data["run"]["status"] == "stopped"
    assert not any(e["event_type"] == "agent_run_completed" for e in data["events"])


@pytest.mark.parametrize("outer_control", ["approve_permission", "deny_permission"])
@pytest.mark.parametrize("inner_control", ["stop_run", "stop_then_resume", "approve_permission", "deny_permission"])
def test_concurrent_permission_control_settles_once(
    client, monkeypatch, session_factory, tmp_path, outer_control, inner_control
):
    session_id, run_id = "audit-extra-control-session", "audit-extra-control-run"
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        assistant_service,
        "_call_llm_streamed",
        lambda *_a, **_k: {"content": "林岚踏进港口。", "completion_tokens": 8, "latency_ms": 1},
    )
    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={
            "run_id": run_id,
            "user_message": "精简这段",
            "intent": "file.revise",
            "permission_profile": "ask",
            "args": {"file_path": str(tmp_path / "chapter.md"), "content": "林岚走进港口。"},
        },
    )
    frames = parse_agent_sse(response.text)
    assert frames[-1]["proposed_patch"]["requires_confirmation"] is True
    original = service_control.resolve_execution_result
    nested = False
    inner_acks = []

    def interleave(payload, *, approved):
        nonlocal nested
        if not nested:
            nested = True
            sequence = ["stop_run", "resume_run"] if inner_control == "stop_then_resume" else [inner_control]
            for command in sequence:
                with session_factory() as session:
                    result = service.handle_agent_control_message(
                        session, public_id=run_id, session_id=session_id, control_type=command
                    )
                    inner_acks.append(service.websocket_control_event(result.event))
                    if command == "resume_run":
                        assert result.resumed_result is None
                        assert result.event.payload["control_effect"] == "ignored"
                        assert result.event.payload["run_status"] == "stopped"
        return original(payload, approved=approved)

    monkeypatch.setattr(service_control, "resolve_execution_result", interleave)
    outer_ack = control_agent(client, session_id, control_type=outer_control, run_id=run_id)
    data = capture(
        client,
        f"{outer_control}-during-{inner_control}",
        session_id,
        run_id,
        frames=frames,
        stream_text=response.text,
        controls=inner_acks + [outer_ack],
    )
    expected = (
        "stopped"
        if inner_control.startswith("stop")
        else ("completed" if inner_control == "approve_permission" else "failed")
    )
    assert inner_acks[0]["control_effect"] == "applied"
    assert data["run"]["status"] == expected
    terminal_count = sum(
        e["event_type"] in {"agent_run_completed", "agent_run_failed", "agent_run_interrupted"} for e in data["events"]
    )
    assert terminal_count == 1
    assert outer_ack["control_effect"] == "ignored"
    assert outer_ack["run_status"] == expected
    assert outer_ack["runtime_state"] == "settled"


@pytest.mark.parametrize("boundary,overwriting_status", [("failure", "failed"), ("permission", "paused")])
def test_stop_before_failure_or_permission_update_cannot_be_overwritten(
    client, monkeypatch, session_factory, engine, tmp_path, boundary, overwriting_status
):
    from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
    from sqlalchemy import event

    session_id, run_id = f"audit-{boundary}-race-session", f"audit-{boundary}-race-run"
    stop_acks = []
    _enable_loop_env(monkeypatch)
    _fake_llm_script(monkeypatch, [RuntimeError("controlled provider failure")])
    monkeypatch.setattr(
        assistant_service,
        "_call_llm_streamed",
        lambda *_a, **_k: {"content": "林岚踏进港口。", "completion_tokens": 8, "latency_ms": 1},
    )
    body = {
        "run_id": run_id,
        "user_message": "精简这段",
        "permission_profile": "ask",
        "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
    }
    if boundary == "permission":
        body["intent"] = "file.revise"
        body["args"].update(file_path=str(tmp_path / "chapter.md"), content="林岚走进港口。")

    def before_update(connection, cursor, statement, parameters, context, executemany):
        if not stop_acks and statement.startswith("UPDATE agent_runs SET status=") and overwriting_status in parameters:
            stop_acks.append(None)
            with session_factory() as session:
                stopped = service.handle_agent_control_message(
                    session, public_id=run_id, session_id=session_id, control_type="stop_run"
                )
                stop_acks[0] = service.websocket_control_event(stopped.event)

    event.listen(engine, "before_cursor_execute", before_update)
    try:
        response = client.post(f"/api/ide/agent/sessions/{session_id}/stream", json=body)
    finally:
        event.remove(engine, "before_cursor_execute", before_update)
    assert stop_acks and stop_acks[0]["run_status"] == "stopped"
    assert stop_acks[0]["control_effect"] == "requested"
    data = capture(
        client,
        f"{boundary}-settlement-stop-race",
        session_id,
        run_id,
        frames=parse_agent_sse(response.text),
        stream_text=response.text,
        controls=stop_acks,
    )
    assert data["run"]["status"] == "stopped"
    assert not any(
        e["event_type"] in {"agent_run_completed", "agent_run_failed", "permission_required"} for e in data["events"]
    )
    assert data["frames"][-1]["proposed_patch"] is None


def test_resume_cas_cannot_accept_new_inflight_pause_aba(client, monkeypatch, session_factory, engine, tmp_path):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from agent_loop_runtime_test_support import _enable_loop_env
    from sqlalchemy import event

    from app.domains.agent_runs import loop_runtime
    from app.domains.agent_runs.runtime import AgentRuntime
    from app.platform.ai_sdk import ChatResponse, ProviderCapabilities

    session_id, run_id = "audit-resume-aba-session", "audit-resume-aba-run"
    _enable_loop_env(monkeypatch)
    calls = []

    def control(command):
        with session_factory() as session:
            result = service.handle_agent_control_message(
                session, public_id=run_id, session_id=session_id, control_type=command
            )
            return service.websocket_control_event(result.event)

    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=False)

        def complete(self, request):
            calls.append(request)
            control("pause_run")
            return ChatResponse(content="完整的已知答复。")

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={
            "run_id": run_id,
            "user_message": "概括这个项目",
            "permission_profile": "read",
            "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
        },
    )
    assert parse_agent_sse(response.text)[-1]["runtime_interruption"]["status"] == "paused"
    # An ordinary repeated pause establishes the same documented control state
    # (paused/paused) that a later in-flight pause will use. No row is fabricated.
    assert control("pause_run")["control_effect"] == "applied"
    original_runtime = AgentRuntime.run_user_message
    a_waiting, allow_a, b_paused, release_workers, duplicate_started = (threading.Event() for _ in range(5))
    mutex = threading.Lock()
    first_cas_seen = False
    executions = []
    pause_acks = []

    def before_cas(connection, cursor, statement, parameters, context, executemany):
        nonlocal first_cas_seen
        if statement.startswith("UPDATE agent_runs SET status=") and "resumed" in parameters:
            with mutex:
                block = not first_cas_seen
                first_cas_seen = True
            if block:
                a_waiting.set()
                assert allow_a.wait(timeout=10)

    def held_runtime(self, session, *, run, **kwargs):
        with mutex:
            executions.append(threading.current_thread().name)
            number = len(executions)
        if number == 1:
            pause_acks.append(control("pause_run"))
            b_paused.set()
        else:
            duplicate_started.set()
        assert release_workers.wait(timeout=10)
        return original_runtime(self, session, run=run, **kwargs)

    monkeypatch.setattr(AgentRuntime, "run_user_message", held_runtime)
    event.listen(engine, "before_cursor_execute", before_cas)
    evidence = None
    cleanup_errors = []
    losing_ack = None
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="resume-audit") as pool:
            a = pool.submit(control, "resume_run")
            assert a_waiting.wait(timeout=5)
            b = pool.submit(control, "resume_run")
            try:
                assert b_paused.wait(timeout=5)
                assert pause_acks[0]["runtime_state"] == "in_flight"
                allow_a.set()
                duplicate_started.wait(timeout=2)
                evidence = capture(
                    client,
                    "resume-pause-aba-in-flight",
                    session_id,
                    run_id,
                    controls=pause_acks,
                    resumed_workers=list(executions),
                )
                losing_ack = a.result(timeout=1) if a.done() else None
                control("stop_run")
            finally:
                allow_a.set()
                release_workers.set()
            for pending in (a, b):
                try:
                    pending.result(timeout=10)
                except service.AgentRuntimeError as exc:
                    # Competing owners can invalidate one another's checkpoint.
                    # Report the primary invariant before this cleanup symptom.
                    cleanup_errors.append(str(exc))
    finally:
        allow_a.set()
        release_workers.set()
        event.remove(engine, "before_cursor_execute", before_cas)
    assert len(calls) == 1
    assert evidence is not None
    assert len(evidence["resumed_workers"]) == 1
    assert losing_ack is not None
    assert losing_ack["control_effect"] == "ignored"
    assert losing_ack["runtime_state"] == "in_flight"
    assert losing_ack["run_status"] == "paused"
    assert cleanup_errors == []
