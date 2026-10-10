"""Independent disposable upgrade/adoption/backfill review for row-local ownership."""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from alembic import command
from app.db import migrations
from app.db.base import Base
from app.db.session import bootstrap_sqlite_database
from app.domains.agent_runs.models import AgentRun, AgentRunEvent


def seed_legacy(engine):
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        runs = [AgentRun(public_id=f'legacy-{i}', session_id='legacy', goal='review', status='paused') for i in range(4)]
        session.add_all(runs)
        session.flush()
        def append(run, kind, sequence, actor='agent-runtime'):
            event = AgentRunEvent(run_id=run.id, event_type=kind, sequence=sequence, actor=actor, payload={})
            session.add(event)
            session.flush()
            return event.id
        first = append(runs[0], 'agent_execution_started', 1)
        other = append(runs[1], 'agent_execution_started', 1)
        latest = append(runs[0], 'agent_execution_claimed', 2)
        append(runs[0], 'agent_execution_settled', 3)
        append(runs[2], 'resume_run', 1, 'desktop-ide')
        session.commit()
        expected = {runs[0].id: latest, runs[1].id: other, runs[2].id: None, runs[3].id: None}
    return expected, first


def owners(engine):
    with engine.connect() as conn:
        return dict(conn.execute(text('SELECT id, execution_owner_event_id FROM agent_runs')).all())


@pytest.mark.parametrize('route', ['managed', 'unmanaged', 'head_missing_column'])
def test_legacy_owner_backfill_all_supported_bootstrap_routes(tmp_path, route):
    engine = create_engine(f'sqlite:///{tmp_path / (route + ".sqlite")}')
    try:
        expected, _ = seed_legacy(engine)
        with engine.begin() as conn:
            if 'execution_owner_event_id' in {c['name'] for c in inspect(engine).get_columns('agent_runs')}:
                conn.exec_driver_sql('ALTER TABLE agent_runs DROP COLUMN execution_owner_event_id')
        if route != 'unmanaged':
            config = migrations.build_alembic_config(engine)
            with engine.connect() as conn:
                config.attributes['connection'] = conn
                command.stamp(config, '20260703_0001' if route == 'managed' else 'head')
        bootstrap_sqlite_database(engine)
        assert 'execution_owner_event_id' in {c['name'] for c in inspect(engine).get_columns('agent_runs')}
        assert owners(engine) == expected
        bootstrap_sqlite_database(engine)
        assert owners(engine) == expected
        assert migrations.current_revision(engine) == migrations.head_revision(engine)
    finally:
        engine.dispose()


def test_existing_row_owner_is_not_rederived_on_startup(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "existing.sqlite"}')
    try:
        expected, first = seed_legacy(engine)
        # A non-NULL stored witness is authoritative; startup fills only legacy NULLs.
        with engine.begin() as conn:
            conn.execute(text('UPDATE agent_runs SET execution_owner_event_id=:owner WHERE id=:run'), {'owner': first, 'run': min(expected)})
        expected[min(expected)] = first
        bootstrap_sqlite_database(engine)
        assert owners(engine) == expected
    finally:
        engine.dispose()


def test_disposable_downgrade_reupgrade_preserves_history(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "roundtrip.sqlite"}')
    try:
        expected, _ = seed_legacy(engine)
        bootstrap_sqlite_database(engine)
        with engine.connect() as conn:
            before = conn.execute(text('SELECT id, run_id, event_type, sequence, actor, payload FROM agent_run_events ORDER BY id')).all()
        config = migrations.build_alembic_config(engine)
        with engine.connect() as conn:
            config.attributes['connection'] = conn
            command.downgrade(config, '20260703_0001')
        assert 'execution_owner_event_id' not in {c['name'] for c in inspect(engine).get_columns('agent_runs')}
        bootstrap_sqlite_database(engine)
        assert owners(engine) == expected
        with engine.connect() as conn:
            assert conn.execute(text('SELECT id, run_id, event_type, sequence, actor, payload FROM agent_run_events ORDER BY id')).all() == before
    finally:
        engine.dispose()


def test_partially_added_column_upgrade_is_idempotent_and_ignores_payload_claims(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "partial.sqlite"}')
    try:
        expected, _ = seed_legacy(engine)
        with engine.begin() as conn:
            conn.execute(text("UPDATE agent_run_events SET payload = :payload WHERE event_type = 'resume_run'"),
                         {'payload': '{"execution_owner_event_id":999,"control_effect":"applied","runtime_state":"in_flight"}'})
        config = migrations.build_alembic_config(engine)
        with engine.connect() as conn:
            config.attributes['connection'] = conn
            command.stamp(config, '20260703_0001')
        # Simulate a previous upgrade that added the nullable column, then exited
        # before backfill/version bookkeeping. The retry must not add it twice.
        bootstrap_sqlite_database(engine)
        assert owners(engine) == expected
        assert migrations.current_revision(engine) == '20261010_0002'
        bootstrap_sqlite_database(engine)
        assert owners(engine) == expected
    finally:
        engine.dispose()


@pytest.mark.parametrize('failure_phase', ['before_column', 'after_column'])
def test_failed_managed_upgrade_repairs_owner_schema_or_fails_closed(tmp_path, monkeypatch, failure_phase):
    engine = create_engine(f'sqlite:///{tmp_path / (failure_phase + ".sqlite")}')
    try:
        expected, _ = seed_legacy(engine)
        with engine.begin() as conn:
            conn.exec_driver_sql('ALTER TABLE agent_runs DROP COLUMN execution_owner_event_id')
            before = conn.exec_driver_sql('SELECT id, public_id, status FROM agent_runs ORDER BY id').all()
            event_before = conn.exec_driver_sql('SELECT id, run_id, event_type, sequence, actor, payload FROM agent_run_events ORDER BY id').all()
        config = migrations.build_alembic_config(engine)
        with engine.connect() as conn:
            config.attributes['connection'] = conn
            command.stamp(config, '20260703_0001')
        def failed_upgrade(target):
            if failure_phase == 'after_column':
                with target.begin() as conn:
                    conn.exec_driver_sql('ALTER TABLE agent_runs ADD COLUMN execution_owner_event_id INTEGER')
            raise RuntimeError('independent injected migration failure')
        monkeypatch.setattr(migrations, 'upgrade_head', failed_upgrade)
        failure = None
        try:
            bootstrap_sqlite_database(engine)
        except Exception as exc:
            failure = exc
        with engine.connect() as conn:
            assert conn.exec_driver_sql('SELECT id, public_id, status FROM agent_runs ORDER BY id').all() == before
            assert conn.exec_driver_sql('SELECT id, run_id, event_type, sequence, actor, payload FROM agent_run_events ORDER BY id').all() == event_before
        # Returning normally advertises usable storage to startup. It must have
        # a readable owner-aware schema with recovered historical ownership.
        if failure is None:
            assert 'execution_owner_event_id' in {c['name'] for c in inspect(engine).get_columns('agent_runs')}
            assert owners(engine) == expected
    finally:
        engine.dispose()


@pytest.mark.parametrize('guard', ['unhealthy', 'backup_failed'])
def test_failed_legacy_safety_guard_does_not_add_owner_schema(tmp_path, monkeypatch, guard):
    engine = create_engine(f'sqlite:///{tmp_path / (guard + ".sqlite")}')
    try:
        seed_legacy(engine)
        with engine.begin() as conn:
            conn.exec_driver_sql('ALTER TABLE agent_runs DROP COLUMN execution_owner_event_id')
            before = conn.exec_driver_sql('SELECT id, public_id, status FROM agent_runs ORDER BY id').all()
        if guard == 'unhealthy':
            monkeypatch.setattr(migrations, 'quick_check', lambda target: (False, 'independent unhealthy fixture'))
        else:
            def failed_backup(*args, **kwargs):
                raise RuntimeError('independent failed required backup')
            monkeypatch.setattr(migrations, 'backup_sqlite_database', failed_backup)
        with pytest.raises(RuntimeError):
            bootstrap_sqlite_database(engine)
        assert 'execution_owner_event_id' not in {c['name'] for c in inspect(engine).get_columns('agent_runs')}
        with engine.connect() as conn:
            assert conn.exec_driver_sql('SELECT id, public_id, status FROM agent_runs ORDER BY id').all() == before
        assert not list(tmp_path.glob('*.pre-alembic-*.bak'))
    finally:
        engine.dispose()


@pytest.mark.parametrize('guard', ['unhealthy', 'backup_failed'])
def test_failed_legacy_guard_does_not_backfill_existing_null_owner(tmp_path, monkeypatch, guard):
    engine = create_engine(f'sqlite:///{tmp_path / (guard + "-null.sqlite")}')
    try:
        seed_legacy(engine)
        before = owners(engine)
        assert all(owner is None for owner in before.values())
        if guard == 'unhealthy':
            monkeypatch.setattr(migrations, 'quick_check', lambda target: (False, 'independent unhealthy fixture'))
        else:
            def failed_backup(*args, **kwargs):
                raise RuntimeError('independent failed required backup')
            monkeypatch.setattr(migrations, 'backup_sqlite_database', failed_backup)
        with pytest.raises(RuntimeError):
            bootstrap_sqlite_database(engine)
        assert owners(engine) == before
    finally:
        engine.dispose()
