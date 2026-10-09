"""Independent ownership review using public control and settlement helpers."""
import pytest

from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.service_control import record_agent_control_event
from app.domains.agent_runs.service_execution import (
    agent_execution_state,
    finish_agent_execution,
    start_agent_execution,
)


@pytest.mark.parametrize('late_kind', ['settled', 'interrupted'])
def test_old_finally_cannot_release_committed_prestart_claim(session_factory, late_kind):
    with session_factory() as session:
        run = AgentRun(public_id='independent-claim', session_id='session', goal='review', status='running')
        session.add(run)
        session.commit()
        started = start_agent_execution(session, run)
        run.status = 'paused'
        run.current_step = 'paused'
        session.commit()
        finish_agent_execution(session, run, started, None)
        resume = record_agent_control_event(session, public_id=run.public_id, session_id=run.session_id, control_type='resume_run')
        assert resume.payload['control_effect'] == 'applied'
        assert agent_execution_state(session, run) == 'in_flight'
        if late_kind == 'interrupted':
            pause = record_agent_control_event(session, public_id=run.public_id, session_id=run.session_id, control_type='pause_run')
            assert pause.payload['control_effect'] == 'requested'
        finish_agent_execution(session, run, started, None)
        assert agent_execution_state(session, run) == 'in_flight'

def test_old_finally_does_not_emit_live_terminal_for_new_claim(session_factory):
    from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event
    with session_factory() as session:
        run = AgentRun(public_id='independent-live', session_id='session', goal='review', status='running')
        session.add(run)
        session.commit()
        started = start_agent_execution(session, run)
        run.status = 'paused'
        run.current_step = 'paused'
        session.commit()
        finish_agent_execution(session, run, started, None)
        record_agent_control_event(session, public_id=run.public_id, session_id=run.session_id, control_type='resume_run')
        record_agent_control_event(session, public_id=run.public_id, session_id=run.session_id, control_type='pause_run')
        _, late = finish_agent_execution(session, run, started, None)
        assert agent_execution_state(session, run) == 'in_flight'
        assert not any(frame['type'] == 'agent_run_interrupted' for frame in websocket_stream_events_from_agent_event(late))

def test_restart_releases_claim_hidden_by_old_finally(session_factory):
    from app.domains.agent_runs.service_store import reap_non_terminal_agent_runs
    with session_factory() as session:
        run = AgentRun(public_id='independent-cold', session_id='session', goal='review', status='running')
        session.add(run)
        session.commit()
        started = start_agent_execution(session, run)
        run.status = 'paused'
        run.current_step = 'paused'
        session.commit()
        finish_agent_execution(session, run, started, None)
        record_agent_control_event(session, public_id=run.public_id, session_id=run.session_id, control_type='resume_run')
        record_agent_control_event(session, public_id=run.public_id, session_id=run.session_id, control_type='pause_run')
        finish_agent_execution(session, run, started, None)
    with session_factory() as restarted:
        run = restarted.get(AgentRun, run.id)
        assert agent_execution_state(restarted, run) == 'in_flight'
        reap_non_terminal_agent_runs(restarted)
        assert agent_execution_state(restarted, run) == 'settled'
