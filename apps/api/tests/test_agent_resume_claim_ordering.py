"""An applied resume retains ownership when its audit row precedes old settlement."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import test_agent_delivery_races as delivery_race_support
from agent_loop_runtime_test_support import _enable_loop_env
from agent_transport import parse_agent_sse

from app.domains.agent_runs import loop_runtime, service, service_control
from app.domains.agent_runs.runtime import AgentRuntime
from app.platform.ai_sdk import ChatResponse, ProviderCapabilities

engine = delivery_race_support.engine


def test_resume_claim_cannot_be_hidden_by_later_old_worker_settlement(client, monkeypatch, session_factory, tmp_path):
    session_id, run_id = "ordered-claim-session", "ordered-claim-run"
    _enable_loop_env(monkeypatch)
    provider_paused, release_provider, audit_recorded, old_settled = (threading.Event() for _ in range(4))
    a_paused, duplicate_claim, allow_start, first_worker, duplicate_worker, release_workers = (
        threading.Event() for _ in range(6)
    )
    lock = threading.Lock()
    calls, claims, workers, pauses, errors = [], [], [], [], []
    held_audit = False
    original_record = service_control.record_agent_event
    original_start = service.start_agent_execution
    original_runtime = AgentRuntime.run_user_message

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
            provider_paused.set()
            assert release_provider.wait(timeout=10)
            return ChatResponse(content="Already known answer.")

    def ordered_audit(session, run, **kwargs):
        nonlocal held_audit
        result = original_record(session, run, **kwargs)
        if kwargs.get("event_type") == "resume_run" and not held_audit:
            held_audit = True
            audit_recorded.set()
            assert old_settled.wait(timeout=10)
        return result

    def gated_start(session, run):
        if run.current_step != "resumed":
            return original_start(session, run)
        with lock:
            claims.append(threading.current_thread().name)
            first = len(claims) == 1
        if first:
            pauses.append(control("pause_run"))
            a_paused.set()
        else:
            duplicate_claim.set()
        assert allow_start.wait(timeout=10)
        return original_start(session, run)

    def gated_runtime(self, session, *, run, **kwargs):
        if run.current_step in {"resumed", "paused"} and old_settled.is_set():
            with lock:
                workers.append(threading.current_thread().name)
                first = len(workers) == 1
            (first_worker if first else duplicate_worker).set()
            assert release_workers.wait(timeout=10)
        return original_runtime(self, session, run=run, **kwargs)

    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    monkeypatch.setattr(service_control, "record_agent_event", ordered_audit)
    monkeypatch.setattr(service, "start_agent_execution", gated_start)
    monkeypatch.setattr(AgentRuntime, "run_user_message", gated_runtime)
    body = {
        "run_id": run_id,
        "user_message": "Summarize",
        "permission_profile": "read",
        "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}},
    }
    snapshot = None
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="ordered-claim") as pool:
        initial = pool.submit(client.post, f"/api/ide/agent/sessions/{session_id}/stream", json=body)
        try:
            assert provider_paused.wait(timeout=5)
            a = pool.submit(control, "resume_run")
            assert audit_recorded.wait(timeout=5)
            release_provider.set()
            initial_frames = parse_agent_sse(initial.result(timeout=10).text)
            assert initial_frames[-1]["runtime_interruption"]["status"] == "paused"
            old_settled.set()
            assert a_paused.wait(timeout=5)
            c = pool.submit(control, "resume_run")
            duplicate_claim.wait(timeout=2)
            allow_start.set()
            assert first_worker.wait(timeout=5)
            duplicate_worker.wait(timeout=2)
            snapshot = delivery_race_support.capture(
                client,
                "ordered-claim",
                session_id,
                run_id,
                controls=pauses,
                claimed_workers=list(claims),
                entered_workers=list(workers),
            )
            control("stop_run")
        finally:
            release_provider.set()
            old_settled.set()
            allow_start.set()
            release_workers.set()
        for pending in (a, c):
            try:
                pending.result(timeout=10)
            except service.AgentRuntimeError as exc:
                errors.append(str(exc))

    assert snapshot is not None
    events = snapshot["events"]
    first_resume = next(e for e in events if e["event_type"] == "resume_run")
    prior_settlement = next(e for e in events if e["event_type"] == "agent_run_interrupted")
    assert first_resume["sequence"] < prior_settlement["sequence"]
    assert first_resume["payload"]["control_effect"] == "applied"
    assert len(calls) == 1
    assert (len(snapshot["claimed_workers"]), len(snapshot["entered_workers"])) == (1, 1), {
        "claims": snapshot["claimed_workers"],
        "runtime_entries": snapshot["entered_workers"],
        "resume_sequence": first_resume["sequence"],
        "old_settlement_sequence": prior_settlement["sequence"],
        "pause_ack": pauses[0],
    }
    assert pauses[0]["control_effect"] == "requested"
    assert pauses[0]["runtime_state"] == "in_flight"
    assert errors == []
