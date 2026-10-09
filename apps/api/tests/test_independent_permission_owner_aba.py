"""A held old proposal decision cannot settle a newer same-run proposal."""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from agent_transport import parse_agent_sse
from test_agent_delivery_races import engine as engine

from app.domains.agent_runs import service, service_control
from app.domains.assistant import service as assistant_service


@pytest.mark.parametrize('decision', ['approve_permission', 'deny_permission'])
def test_old_permission_decision_does_not_cross_new_execution_aba(client, monkeypatch, session_factory, tmp_path, engine, decision):
    target = tmp_path / 'chapter.md'
    original = 'The light was out.\n'
    target.write_text(original)
    calls = []
    monkeypatch.setattr(assistant_service, 'missing_book_generation_env', lambda: [])
    def generate(*args, **kwargs):
        calls.append(True)
        return {'content': f'The lighthouse was dark, version {len(calls)}.\n', 'completion_tokens': 8, 'latency_ms': 1}
    monkeypatch.setattr(assistant_service, '_call_llm', generate)
    monkeypatch.setattr(assistant_service, '_call_llm_streamed', generate)
    body = {'run_id': 'permission-aba', 'user_message': 'Revise', 'intent': 'file.revise', 'permission_profile': 'ask',
        'args': {'project_path': str(tmp_path), 'file_path': str(target), 'content': original, 'context_bundle': {'files': []}}}
    def request():
        frames = parse_agent_sse(client.post('/api/ide/agent/sessions/permission-session/stream', json=body).text)
        return frames[-1]
    def control(kind):
        with session_factory() as session:
            result = service.handle_agent_control_message(session, public_id='permission-aba', session_id='permission-session', control_type=kind)
            return service.websocket_control_event(result.event)
    first = request()
    assert first['proposed_patch']
    old_resolved, release_old = threading.Event(), threading.Event()
    resolve = service_control.resolve_execution_result
    def held_resolution(*args, **kwargs):
        result = resolve(*args, **kwargs)
        old_resolved.set()
        assert release_old.wait(10)
        return result
    monkeypatch.setattr(service_control, 'resolve_execution_result', held_resolution)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(control, decision)
        try:
            assert old_resolved.wait(5)
            assert control('stop_run')['control_effect'] == 'applied'
            body['user_message'] = 'Revise again'
            body['assistant_session_id'] = first['assistant_session_id']
            newer = request()
            assert newer['proposed_patch']['id'] != first['proposed_patch']['id']
            assert client.get('/api/agent-runs/permission-aba').json()['status'] == 'paused'
            pending_before = [event for event in client.get('/api/agent-runs/permission-aba/events').json()
                              if event['event_type'] == 'permission_required']
            release_old.set()
            ack = pending.result(5)
            assert ack['control_effect'] == 'ignored', ack
            assert ack['run_status'] == 'paused'
            assert client.get('/api/agent-runs/permission-aba').json()['status'] == 'paused'
            pending_after = [event for event in client.get('/api/agent-runs/permission-aba/events').json()
                             if event['event_type'] == 'permission_required']
            assert pending_after == pending_before
            assert pending_after[-1]['payload']['proposed_patch'] == newer['proposed_patch']
            fresh = control(decision)
            assert fresh['control_effect'] == 'applied'
            assert fresh['run_status'] == ('completed' if decision == 'approve_permission' else 'failed')
        finally:
            release_old.set()
    assert len(calls) == 2
    assert target.read_text() == original
