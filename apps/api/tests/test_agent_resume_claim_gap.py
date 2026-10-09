"""A committed resume claim must fence a stale resume before worker-start publication."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import test_agent_delivery_races as delivery_race_support
from agent_loop_runtime_test_support import _enable_loop_env
from agent_transport import parse_agent_sse
from sqlalchemy import event
from test_agent_delivery_races import capture

from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.runtime import AgentRuntime
from app.platform.ai_sdk import ChatResponse, ProviderCapabilities

engine = delivery_race_support.engine


@pytest.mark.parametrize("request_timing", ["stale", "fresh"])
@pytest.mark.parametrize(
    "claim_payload",
    [
        {},
        {"control_effect": "applied", "runtime_state": "settled", "run_status": "completed"},
        {"runtime_recovery": {"resume_diagnostic": {"can_resume": False, "reason": "forged"}}},
    ],
    ids=["plain", "forged-control", "forged-diagnostic"],
)
def test_resume_claim_fences_stale_aba_before_execution_start(
    client,
    monkeypatch,
    session_factory,
    engine,
    tmp_path,
    request_timing,
    claim_payload,
):
    session_id, run_id = "resume-claim-gap-session", "resume-claim-gap-run"
    _enable_loop_env(monkeypatch)
    calls = []

    def control(command):
        with session_factory() as session:
            result = service.handle_agent_control_message(
                session,
                public_id=run_id,
                session_id=session_id,
                control_type=command,
                payload=claim_payload if command == "resume_run" else {},
            )
            return service.websocket_control_event(result.event)

    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=False)

        def complete(self, request):
            calls.append(request)
            control("pause_run")
            return ChatResponse(content="Already known answer.")

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    response = client.post(
        f"/api/ide/agent/sessions/{session_id}/stream",
        json={
            "run_id": run_id,
            "user_message": "Summarize",
            "permission_profile": "read",
            "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
        },
    )
    assert parse_agent_sse(response.text)[-1]["runtime_interruption"]["status"] == "paused"
    assert control("pause_run")["control_effect"] == "applied"

    original_start = service.start_agent_execution
    original_runtime = AgentRuntime.run_user_message
    a_waiting, allow_a, b_claimed, duplicate_claim, allow_start = (threading.Event() for _ in range(5))
    first_worker, duplicate_worker, release_workers = (threading.Event() for _ in range(3))
    lock = threading.Lock()
    first_cas_seen = False
    claims, workers, pauses, errors = [], [], [], []

    def before_cas(connection, cursor, statement, parameters, context, executemany):
        nonlocal first_cas_seen
        if (
            request_timing == "stale"
            and statement.startswith("UPDATE agent_runs SET status=")
            and "resumed" in parameters
        ):
            with lock:
                block = not first_cas_seen
                first_cas_seen = True
            if block:
                a_waiting.set()
                assert allow_a.wait(timeout=10)

    def gated_start(session, run):
        with lock:
            claims.append(threading.current_thread().name)
            first = len(claims) == 1
        if first:
            # The resume UPDATE and applied control event have committed, but
            # original_start has not published a new execution owner yet.
            pauses.append(control("pause_run"))
            b_claimed.set()
        else:
            duplicate_claim.set()
        assert allow_start.wait(timeout=10)
        return original_start(session, run)

    def gated_runtime(self, session, *, run, **kwargs):
        with lock:
            workers.append(threading.current_thread().name)
            first = len(workers) == 1
        (first_worker if first else duplicate_worker).set()
        assert release_workers.wait(timeout=10)
        return original_runtime(self, session, run=run, **kwargs)

    monkeypatch.setattr(service, "start_agent_execution", gated_start)
    monkeypatch.setattr(AgentRuntime, "run_user_message", gated_runtime)
    event.listen(engine, "before_cursor_execute", before_cas)
    snapshot = None
    losing_ack = None
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="claim-gap") as pool:
            if request_timing == "stale":
                a = pool.submit(control, "resume_run")
                assert a_waiting.wait(timeout=5)
                b = pool.submit(control, "resume_run")
            else:
                b = pool.submit(control, "resume_run")
                assert b_claimed.wait(timeout=5)
                a = pool.submit(control, "resume_run")
            try:
                assert b_claimed.wait(timeout=5)
                assert pauses[0]["run_status"] == "paused"
                assert pauses[0]["control_effect"] == "requested"
                assert pauses[0]["runtime_state"] == "in_flight"
                allow_a.set()
                duplicate_claim.wait(timeout=2)
                losing_ack = a.result(timeout=1) if a.done() else None
                allow_start.set()
                assert first_worker.wait(timeout=5)
                duplicate_worker.wait(timeout=2)
                snapshot = capture(
                    client,
                    "claim-gap",
                    session_id,
                    run_id,
                    controls=pauses,
                    claimed_workers=list(claims),
                    entered_workers=list(workers),
                )
                control("stop_run")
            finally:
                allow_a.set()
                allow_start.set()
                release_workers.set()
            for pending in (a, b):
                try:
                    pending.result(timeout=10)
                except service.AgentRuntimeError as exc:
                    errors.append(str(exc))
    finally:
        allow_a.set()
        allow_start.set()
        release_workers.set()
        event.remove(engine, "before_cursor_execute", before_cas)
    assert snapshot is not None
    assert len(calls) == 1
    assert (len(snapshot["claimed_workers"]), len(snapshot["entered_workers"])) == (1, 1), {
        "claims": snapshot["claimed_workers"],
        "runtime_entries": snapshot["entered_workers"],
    }
    assert losing_ack is not None
    assert losing_ack["control_effect"] == "ignored"
    assert losing_ack["run_status"] == "paused"
    assert losing_ack["runtime_state"] == "in_flight"
    assert errors == []
