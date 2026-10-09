"""A committed owner never carries its publication write lock into slow work."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import test_agent_delivery_races as delivery_race_support
from agent_loop_runtime_test_support import _enable_loop_env
from agent_transport import control_agent, stream_agent_message

from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.service_execution import agent_execution_state
from app.platform.ai_sdk import ChatResponse, ProviderCapabilities

engine = delivery_race_support.engine


@pytest.mark.parametrize("wait_kind", ["provider", "tool"])
@pytest.mark.parametrize("control", ["pause_run", "stop_run"])
def test_control_commits_before_blocked_provider_or_tool_releases(
    client, monkeypatch, session_factory, tmp_path, wait_kind, control,
):
    entered, release = threading.Event(), threading.Event()
    waits = []
    session_id, run_id = "independent-wait-session", "independent-wait-run"

    def hold_work():
        waits.append(wait_kind)
        entered.set()
        assert release.wait(timeout=12)

    if wait_kind == "provider":
        _enable_loop_env(monkeypatch)

        class Provider:
            def capabilities(self, model):
                return ProviderCapabilities(streaming=False)

            def complete(self, request):
                hold_work()
                return ChatResponse(content="Known answer.")

        monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: Provider())
        args = {"project_path": str(tmp_path), "context_bundle": {"files": []}}
        intent = None
    else:
        original = service.AgentRuntime._file_review

        def blocked_review(runtime, context, payload):
            hold_work()
            return original(runtime, context, payload)

        monkeypatch.setattr(service.AgentRuntime, "_file_review", blocked_review)
        args = {"file_path": str(tmp_path / "chapter.md"), "content": "The harbor was quiet."}
        intent = "file.review"

    with ThreadPoolExecutor(max_workers=2) as pool:
        request = pool.submit(
            stream_agent_message, client, session_id, run_id=run_id, user_message="Review this paragraph",
            permission_profile="read", intent=intent, args=args,
        )
        try:
            assert entered.wait(timeout=5)
            with session_factory() as session:
                run = service.get_agent_run(session, run_id)
                owner_id = run.execution_owner_event_id
                assert owner_id is not None
                assert agent_execution_state(session, run) == "in_flight"
            controlled = pool.submit(control_agent, client, session_id, control_type=control, run_id=run_id)
            ack = controlled.result(timeout=4)
            assert not release.is_set()
            expected_status = "paused" if control == "pause_run" else "stopped"
            assert ack["control_effect"] == "requested"
            assert ack["run_status"] == expected_status
            with session_factory() as session:
                run = service.get_agent_run(session, run_id)
                assert run.status == expected_status
                assert run.execution_owner_event_id == owner_id
        finally:
            release.set()
        frames = request.result(timeout=5)
    assert waits == [wait_kind]
    assert frames[-1]["runtime_interruption"]["status"] == expected_status
    with session_factory() as session:
        run = service.get_agent_run(session, run_id)
        assert run.status == expected_status
        assert agent_execution_state(session, run) == "settled"
