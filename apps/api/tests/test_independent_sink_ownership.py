"""Positive and stale-owner controls for the actual runtime event sink."""
import pytest

from app.domains.agent_runs.event_sink import AgentRunEventSink
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.service_execution import start_agent_execution
from app.domains.agent_runs.service_store import list_agent_run_events


@pytest.mark.parametrize('transition', ['complete', 'fail', 'permission'])
@pytest.mark.parametrize('superseded', [False, True])
def test_terminal_sink_checks_execution_owner(session_factory, transition, superseded):
    with session_factory() as session:
        run = AgentRun(public_id='sink-owner', session_id='session', goal='review', status='running')
        session.add(run)
        session.commit()
        owner = start_agent_execution(session, run)
        emitted = []
        sink = AgentRunEventSink(session, on_event=emitted.append)
        sink.bind_execution(owner)
        if superseded:
            start_agent_execution(session, run)
        result = {'agent_result': {'summary': 'Done'}, 'intent': 'chat.explain', 'proposed_patch': None}
        if transition == 'complete':
            sink.complete(run, result)
        elif transition == 'fail':
            sink.fail(run, message='Controlled failure')
        else:
            sink.record_permission_required(run, result, reason='Controlled permission')
        session.refresh(run)
        terminals = [e for e in list_agent_run_events(session, run.public_id) if e.event_type in {'agent_run_completed', 'agent_run_failed', 'permission_required'}]
        if superseded:
            assert run.status == 'running'
            assert terminals == []
            assert emitted == []
        else:
            assert run.status == {'complete': 'completed', 'fail': 'failed', 'permission': 'paused'}[transition]
            assert len(terminals) == len(emitted) == 1
            assert terminals[0].payload['execution_id'] == owner.id
