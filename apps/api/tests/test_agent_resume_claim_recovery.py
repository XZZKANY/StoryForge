"""Startup settles durable resume claims abandoned before worker start."""

from __future__ import annotations

import pytest
import test_agent_delivery_races as delivery_race_support
from agent_loop_runtime_test_support import _enable_loop_env
from agent_transport import control_agent, parse_agent_sse

from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.loop.checkpoint_store import latest_checkpoint_artifact
from app.domains.agent_runs.service_execution import agent_execution_state
from app.domains.assistant import service as assistant_service
from app.platform.ai_sdk import ChatResponse, ProviderCapabilities

engine = delivery_race_support.engine


class SimulatedProcessExit(BaseException):
    pass


@pytest.mark.parametrize("kind", ["chat_checkpoint", "chapter_brief"])
@pytest.mark.parametrize("pause_after_claim", [False, True])
@pytest.mark.parametrize("late_previous_exit", [False, True])
def test_startup_settles_abandoned_resume_claim(
    client, monkeypatch, session_factory, engine, tmp_path, kind, pause_after_claim, late_previous_exit
):
    session_id, run_id = "cold-resume-session", "cold-resume-run"
    provider_calls = []
    target = tmp_path / "chapter.md"
    target.write_text("", encoding="utf-8")
    body = {
        "run_id": run_id,
        "user_message": "Help with chapter one",
        "permission_profile": "ask",
        "args": {"project_path": str(tmp_path), "file_path": str(target), "context_bundle": {"files": []}},
    }

    if kind == "chat_checkpoint":
        _enable_loop_env(monkeypatch)

        class Provider:
            def capabilities(self, model):
                return ProviderCapabilities(streaming=False)

            def complete(self, request):
                provider_calls.append(request)
                with session_factory() as session:
                    service.handle_agent_control_message(
                        session, public_id=run_id, session_id=session_id, control_type="pause_run"
                    )
                return ChatResponse(content="Already generated answer.")

        monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
    else:
        body["intent"] = "chapter.write"
        monkeypatch.setattr(
            assistant_service,
            "chat_reply",
            lambda *args, **kwargs: {"reply": '{"goal":"Establish conflict","required_beats":["Meet"]}'},
        )

    initial = parse_agent_sse(client.post(f"/api/ide/agent/sessions/{session_id}/stream", json=body).text)[-1]
    assert initial["type"] == "agent_result"
    with session_factory() as session:
        run = service.get_agent_run(session, run_id)
        assert run.status == "paused"
        assert agent_execution_state(session, run) == "settled"
        assert (latest_checkpoint_artifact(session, run) is not None) == (kind == "chat_checkpoint")
        initial_starts = sum(
            e.event_type == "agent_execution_started" for e in service.list_agent_run_events(session, run_id)
        )
        previous_started = next(
            e for e in service.list_agent_run_events(session, run_id) if e.event_type == "agent_execution_started"
        )

    def exit_before_start(session, run):
        if pause_after_claim:
            with session_factory() as control_session:
                paused = service.handle_agent_control_message(
                    control_session, public_id=run_id, session_id=session_id, control_type="pause_run"
                )
                assert paused.event.payload["control_effect"] == "requested"
        raise SimulatedProcessExit()

    with monkeypatch.context() as patch:
        patch.setattr(service, "start_agent_execution", exit_before_start)
        with session_factory() as session, pytest.raises(SimulatedProcessExit):
            service.handle_agent_control_message(
                session, public_id=run_id, session_id=session_id, control_type="resume_run"
            )

    # Only committed state survives. Reopen the physical SQLite connection and
    # invoke the same reaper used by startup; no fabricated statuses or timeout.
    engine.dispose()
    with session_factory() as restarted:
        run = service.get_agent_run(restarted, run_id)
        assert run.status == ("paused" if pause_after_claim else "running")
        assert agent_execution_state(restarted, run) == "in_flight"
        assert (
            sum(e.event_type == "agent_execution_started" for e in service.list_agent_run_events(restarted, run_id))
            == initial_starts
        )
        if late_previous_exit:
            # Exercise the existing stale-finally contract using the actual prior
            # execution record, rather than manufacturing a settlement payload.
            service.finish_agent_execution(restarted, run, previous_started, None)
            assert agent_execution_state(restarted, run) == "in_flight"
        service.reap_non_terminal_agent_runs(restarted)
        restarted.refresh(run)
        state = agent_execution_state(restarted, run)
        assert state == "settled", {
            "kind": kind,
            "pause_after_claim": pause_after_claim,
            "run_status": run.status,
            "current_step": run.current_step,
            "runtime_state": state,
        }
        before_repeat = [e.id for e in service.list_agent_run_events(restarted, run_id)]
        service.reap_non_terminal_agent_runs(restarted)
        assert [e.id for e in service.list_agent_run_events(restarted, run_id)] == before_repeat
        if kind == "chat_checkpoint":
            assert run.status == "paused"
            assert service.get_agent_run_save_points(restarted, run_id)["recoverability"]["can_resume"] is True

    if kind == "chat_checkpoint":
        resumed = control_agent(client, session_id, control_type="resume_run", run_id=run_id)
        assert resumed["control_effect"] == "applied"
        assert resumed["runtime_state"] == "settled"
        assert resumed["resumed_result"]["run_id"] == run_id
        assert resumed["resumed_result"]["agent_result"]["summary"] == "Already generated answer."
        assert len(provider_calls) == 1
    assert target.read_text(encoding="utf-8") == ""
