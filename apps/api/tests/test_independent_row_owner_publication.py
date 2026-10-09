"""Independent atomic row-witness publication and API privacy review."""
from __future__ import annotations

import pytest
from sqlalchemy import event, select

from app.domains.agent_runs.models import AgentRun, AgentRunEvent
from app.domains.agent_runs.service_control import record_agent_control_event
from app.domains.agent_runs.service_execution import finish_agent_execution, start_agent_execution
from app.domains.agent_runs.service_store import record_agent_event


@pytest.mark.parametrize('kind', ['agent_execution_started', 'agent_execution_claimed'])
@pytest.mark.parametrize('failure', ['owner_update', 'commit'])
def test_owner_and_event_publish_or_rollback_together(session_factory, engine, kind, failure):
    with session_factory() as session:
        run = AgentRun(public_id='row-publication', session_id='session', goal='Review', status='running')
        session.add(run)
        session.commit()
        old = start_agent_execution(session, run)
        old_id, run_id = old.id, run.id
    triggered = []
    def fail_update(conn, cursor, statement, parameters, context, executemany):
        if (statement.startswith('UPDATE agent_runs SET') and 'execution_owner_event_id=' in statement
                and 'execution_owner_event_id=agent_runs.execution_owner_event_id' not in statement):
            triggered.append(True)
            raise RuntimeError('independent owner update failure')
    def fail_commit(conn):
        triggered.append(True)
        raise RuntimeError('independent commit failure')
    name, callback = ('before_cursor_execute', fail_update) if failure == 'owner_update' else ('commit', fail_commit)
    event.listen(engine, name, callback)
    try:
        with session_factory() as session:
            run = session.get(AgentRun, run_id)
            with pytest.raises(RuntimeError, match='independent'):
                record_agent_event(session, run, event_type=kind, actor='agent-runtime', payload={})
            session.rollback()
    finally:
        event.remove(engine, name, callback)
    assert triggered
    with session_factory() as reopened:
        run = reopened.get(AgentRun, run_id)
        assert run.execution_owner_event_id == old_id
        assert list(reopened.scalars(select(AgentRunEvent.id).where(AgentRunEvent.run_id == run_id))) == [old_id]
        new = record_agent_event(reopened, run, event_type=kind, actor='agent-runtime', payload={})
        reopened.refresh(run)
        assert run.execution_owner_event_id == new.id
        assert new.id != old_id


def test_resume_witness_is_server_owned_and_absent_from_public_run(client, session_factory):
    with session_factory() as session:
        run = AgentRun(public_id='row-private', session_id='session', goal='Review', status='paused', current_step='paused')
        session.add(run)
        session.commit()
        old = start_agent_execution(session, run)
        finish_agent_execution(session, run, old, None)
        control = record_agent_control_event(session, public_id=run.public_id, session_id=run.session_id,
            control_type='resume_run', payload={'execution_owner_event_id': 987654321, 'control_effect': 'applied', 'runtime_recovery': {'resume_diagnostic': {'can_resume': False}}})
        session.refresh(run)
        claim = session.scalar(select(AgentRunEvent).where(AgentRunEvent.run_id == run.id, AgentRunEvent.event_type == 'agent_execution_claimed').order_by(AgentRunEvent.sequence.desc()))
        assert control.payload['control_effect'] == 'applied'
        assert run.execution_owner_event_id == claim.id
        assert run.execution_owner_event_id != 987654321
        assert 'runtime_recovery' not in control.payload
    response = client.get('/api/agent-runs/row-private')
    assert response.status_code == 200
    assert 'execution_owner_event_id' not in response.json()
