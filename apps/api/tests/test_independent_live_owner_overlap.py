"""Actual API proof that ordinary same-run user messages can overlap owners."""
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from agent_loop_runtime_test_support import _enable_loop_env
from agent_transport import parse_agent_sse
from test_agent_delivery_races import engine as engine

from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.service_execution import agent_execution_state
from app.platform.ai_sdk import ChatResponse, ProviderCapabilities


@pytest.mark.parametrize('pause_new_owner', [True, False])
def test_same_run_api_old_worker_cannot_emit_current_terminal(client, monkeypatch, session_factory, engine, tmp_path, pause_new_owner):
    _enable_loop_env(monkeypatch)
    first_entered, second_entered, release_first, release_second = [threading.Event() for _ in range(4)]
    lock = threading.Lock()
    calls = []

    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=False)

        def complete(self, request):
            with lock:
                calls.append(request)
                index = len(calls)
            (first_entered if index == 1 else second_entered).set()
            assert (release_first if index == 1 else release_second).wait(10)
            return ChatResponse(content=f'Answer {index}')

    monkeypatch.setattr(loop_runtime, 'build_llm_provider', lambda source: Provider())
    def request():
        response = client.post('/api/ide/agent/sessions/overlap-session/stream', json={
            'run_id': 'overlap-run', 'user_message': 'Summarize', 'permission_profile': 'read',
            'args': {'project_path': str(tmp_path), 'context_bundle': {'files': []}},
        })
        return parse_agent_sse(response.text)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(request)
        try:
            assert first_entered.wait(5)
            second = pool.submit(request)
            assert second_entered.wait(5)
            if pause_new_owner:
                with session_factory() as session:
                    paused = service.handle_agent_control_message(session, public_id='overlap-run', session_id='overlap-session', control_type='pause_run')
                    assert paused.event.payload['control_effect'] == 'requested'
            release_first.set()
            old_frames = first.result(5)
            with session_factory() as session:
                run = service.get_agent_run(session, 'overlap-run')
                assert agent_execution_state(session, run) == 'in_flight'
                assert run.status == ('paused' if pause_new_owner else 'running'), {'status': run.status, 'old_frames': old_frames}
            assert not any(frame['type'] == 'agent_run_interrupted' for frame in old_frames), old_frames
        finally:
            release_first.set()
            release_second.set()
        second.result(5)

def test_prestart_constructor_failure_cannot_fail_newer_execution(client, monkeypatch, session_factory, engine, tmp_path):
    from app.domains.agent_runs.errors import AgentOrchestrationError
    _enable_loop_env(monkeypatch)
    first_constructor, release_constructor, newer_provider, release_provider = [threading.Event() for _ in range(4)]
    original_runtime = service.AgentRuntime
    constructions = []
    lock = threading.Lock()
    class ConstructorRuntime(original_runtime):
        def __init__(self, *args, **kwargs):
            with lock:
                constructions.append(True)
                first = len(constructions) == 1
            if first:
                first_constructor.set()
                assert release_constructor.wait(10)
                raise AgentOrchestrationError('Controlled constructor failure')
            super().__init__(*args, **kwargs)
    class Provider:
        def capabilities(self, model):
            return ProviderCapabilities(streaming=False)
        def complete(self, request):
            newer_provider.set()
            assert release_provider.wait(10)
            return ChatResponse(content='New owner answer')
    monkeypatch.setattr(service, 'AgentRuntime', ConstructorRuntime)
    monkeypatch.setattr(loop_runtime, 'build_llm_provider', lambda source: Provider())
    def request():
        return parse_agent_sse(client.post('/api/ide/agent/sessions/constructor-session/stream', json={
            'run_id': 'constructor-run', 'user_message': 'Summarize', 'permission_profile': 'read',
            'args': {'project_path': str(tmp_path), 'context_bundle': {'files': []}},
        }).text)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(request)
        try:
            assert first_constructor.wait(5)
            second = pool.submit(request)
            assert newer_provider.wait(5)
            release_constructor.set()
            old_frames = first.result(5)
            assert old_frames[-1]['type'] == 'error'
            with session_factory() as session:
                run = service.get_agent_run(session, 'constructor-run')
                assert run.status == 'running'
                assert agent_execution_state(session, run) == 'in_flight'
        finally:
            release_constructor.set()
            release_provider.set()
        second.result(5)

def test_current_constructor_failure_still_settles_its_own_run(client, monkeypatch, session_factory, tmp_path):
    from app.domains.agent_runs.errors import AgentOrchestrationError
    def fail_constructor(*args, **kwargs):
        raise AgentOrchestrationError('Controlled current constructor failure')
    monkeypatch.setattr(service, 'AgentRuntime', fail_constructor)
    frames = parse_agent_sse(client.post('/api/ide/agent/sessions/current-constructor/stream', json={
        'run_id': 'current-constructor-run', 'user_message': 'Summarize', 'permission_profile': 'read',
        'args': {'project_path': str(tmp_path), 'context_bundle': {'files': []}},
    }).text)
    assert frames[-1]['type'] == 'error'
    with session_factory() as session:
        run = service.get_agent_run(session, 'current-constructor-run')
        assert run.status == 'failed'
        assert agent_execution_state(session, run) == 'settled'
