"""W2：SQLite sidecar 的 alembic schema 收口测试。

覆盖三条起服分支（全新 / 存量 create_all 纳管 / 已纳管 upgrade），F01 定时炸弹的
前向迁移落地，备份 + quick_check + 保留策略，以及 downgrade 可用性冒烟。
"""

from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy import create_engine, inspect

from alembic import command
from app.db import migrations
from app.db import session as db_session


def _make_engine(tmp_path, name: str = "storyforge.sqlite3"):
    path = tmp_path / name
    return create_engine(f"sqlite:///{path.as_posix()}", connect_args={"timeout": 30})


def _schema_snapshot(engine) -> dict[str, list[str]]:
    inspector = inspect(engine)
    tables = [t for t in inspector.get_table_names() if t != "alembic_version"]
    return {t: sorted(c["name"] for c in inspector.get_columns(t)) for t in sorted(tables)}


def _column_names(engine, table: str) -> list[str]:
    return [c["name"] for c in inspect(engine).get_columns(table)]


def _index_names(engine, table: str) -> list[str]:
    return [i["name"] for i in inspect(engine).get_indexes(table)]


def test_fresh_bootstrap_stamps_head(tmp_path) -> None:
    """全新库：create_all 建表后必须 stamp 到 head，纳入 alembic 管理。"""

    engine = _make_engine(tmp_path)
    try:
        db_session.bootstrap_sqlite_database(engine)
        assert inspect(engine).has_table("books")
        assert inspect(engine).has_table("assistant_sessions")
        assert migrations.current_revision(engine) == migrations.head_revision(engine)
    finally:
        engine.dispose()


def test_legacy_create_all_db_is_adopted(tmp_path) -> None:
    """存量 create_all 库（无 alembic_version）：纳管后 stamp head、留备份，
    且逐表逐列结构与全新库一致。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    legacy = _make_engine(tmp_path, "legacy.sqlite3")
    fresh = _make_engine(tmp_path, "fresh.sqlite3")
    try:
        # 模拟 W2 之前的存量库：只有 create_all 建的表，没有 alembic_version。
        Base.metadata.create_all(legacy)
        assert "alembic_version" not in inspect(legacy).get_table_names()

        db_session.bootstrap_sqlite_database(legacy)
        db_session.bootstrap_sqlite_database(fresh)

        assert migrations.current_revision(legacy) == migrations.head_revision(legacy)
        assert _schema_snapshot(legacy) == _schema_snapshot(fresh)

        backups = list((tmp_path).glob("legacy.sqlite3.pre-alembic-*.bak"))
        assert len(backups) == 1, f"纳管应留一份备份，实际 {backups}"
    finally:
        legacy.dispose()
        fresh.dispose()


def test_managed_db_applies_pending_migration(tmp_path) -> None:
    """F01 定时炸弹：已纳管库缺列时，起服 upgrade head 必须把列补回来。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    engine = _make_engine(tmp_path)
    try:
        Base.metadata.create_all(engine)
        # 模拟旧版库：删掉 project_path 及其索引，并 stamp 到该列引入之前的版本。
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP INDEX IF EXISTS ix_assistant_sessions_project_path")
            conn.exec_driver_sql("ALTER TABLE assistant_sessions DROP COLUMN project_path")
        config = migrations.build_alembic_config(engine)
        with engine.connect() as conn:
            config.attributes["connection"] = conn
            command.stamp(config, "20260630_0001")
        assert "project_path" not in _column_names(engine, "assistant_sessions")

        db_session.bootstrap_sqlite_database(engine)

        assert "project_path" in _column_names(engine, "assistant_sessions")
        assert migrations.current_revision(engine) == migrations.head_revision(engine)
    finally:
        engine.dispose()


def test_adoption_backfills_column_missing_on_legacy_table(tmp_path) -> None:
    """真机实证的 F01 漏点：旧版模型建的存量表缺列（assistant_sessions.project_path），
    无 alembic_version 走纳管路径——create_all 跳过存量表、stamp head 又跳过加列迁移，
    收口对账必须把列补回来，否则带该列的 INSERT 起服即崩。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    engine = _make_engine(tmp_path, "legacy.sqlite3")
    try:
        Base.metadata.create_all(engine)
        # 模拟 project_path 引入之前的旧版存量表：删列删索引、且没有 alembic_version。
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP INDEX IF EXISTS ix_assistant_sessions_project_path")
            conn.exec_driver_sql("ALTER TABLE assistant_sessions DROP COLUMN project_path")
        assert "project_path" not in _column_names(engine, "assistant_sessions")
        assert "alembic_version" not in inspect(engine).get_table_names()

        db_session.bootstrap_sqlite_database(engine)

        assert "project_path" in _column_names(engine, "assistant_sessions")
        # 复现用户真机那条 INSERT，验证补列后不再崩。
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "INSERT INTO assistant_sessions (title, task_type, project_path) "
                "VALUES ('IDE Agent: 1', 'ide_agent_orchestration', 'D:/testsf')"
            )
        assert migrations.current_revision(engine) == migrations.head_revision(engine)
    finally:
        engine.dispose()


def test_reconcile_salvages_column_on_db_already_stamped_head(tmp_path) -> None:
    """更狠的一档：库此前已被（旧版 buggy 纳管）stamp 到 head 却仍缺列——managed 路径
    upgrade head 是 no-op 救不回来，必须靠收口对账补列。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    engine = _make_engine(tmp_path)
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP INDEX IF EXISTS ix_assistant_sessions_project_path")
            conn.exec_driver_sql("ALTER TABLE assistant_sessions DROP COLUMN project_path")
        config = migrations.build_alembic_config(engine)
        with engine.connect() as conn:
            config.attributes["connection"] = conn
            command.stamp(config, "head")
        assert "project_path" not in _column_names(engine, "assistant_sessions")
        assert migrations.current_revision(engine) == migrations.head_revision(engine)

        db_session.bootstrap_sqlite_database(engine)

        assert "project_path" in _column_names(engine, "assistant_sessions")
    finally:
        engine.dispose()


def test_reconcile_backfills_not_null_timestamp_column_on_empty_table(tmp_path) -> None:
    """M4：NOT NULL func.now() 时间列（created_at/updated_at 遍布 TimestampMixin 的 50+ 张表）
    此前 _render_server_default 认不出（既非 .text 也非 str）→ 一律「不敢补」被跳过，F01
    「最后一道网」对最常见的加列列型有洞。收口对账现编译 func.now()→CURRENT_TIMESTAMP：
    空存量表能补回，且后续省略该列的 INSERT 拿到当前时间戳、不再起服即崩。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    engine = _make_engine(tmp_path, "ts_empty.sqlite3")
    try:
        Base.metadata.create_all(engine)
        # 模拟旧版建的空存量表缺 updated_at（func.now() NOT NULL）。
        with engine.begin() as conn:
            conn.exec_driver_sql("ALTER TABLE assistant_sessions DROP COLUMN updated_at")
        assert "updated_at" not in _column_names(engine, "assistant_sessions")

        db_session.bootstrap_sqlite_database(engine)

        assert "updated_at" in _column_names(engine, "assistant_sessions")
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "INSERT INTO assistant_sessions (title, task_type) "
                "VALUES ('新会话', 'ide_agent_orchestration')"
            )
            value = conn.exec_driver_sql(
                "SELECT updated_at FROM assistant_sessions"
            ).scalar_one()
        assert value is not None  # 新行拿到 CURRENT_TIMESTAMP，非空
    finally:
        engine.dispose()


def test_reconcile_skips_non_constant_default_on_non_empty_table(tmp_path) -> None:
    """SQLite 限制：非空表无法 ADD 一个 NOT NULL 非常量默认列（CURRENT_TIMESTAMP）。收口对账
    不得因此崩——单列失败被 try/except 兜住、跳过该列、其余照常起服（列仍缺，需 alembic batch
    重建表才能补，属已知残留）。这里锁定「不阻断起服」这条底线。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    engine = _make_engine(tmp_path, "ts_nonempty.sqlite3")
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "INSERT INTO assistant_sessions (title, task_type) "
                "VALUES ('旧会话', 'ide_agent_orchestration')"
            )
            conn.exec_driver_sql("ALTER TABLE assistant_sessions DROP COLUMN updated_at")

        # 不抛：单列补列失败被兜住，起服不中断。
        db_session.bootstrap_sqlite_database(engine)

        # 已有的可空列（project_path）仍照常补回，证明对账整体没被单列失败带崩。
        assert "project_path" in _column_names(engine, "assistant_sessions")
    finally:
        engine.dispose()


def test_adoption_restores_agent_run_event_unique_index(tmp_path) -> None:
    """存量表上 create_all 不补索引：纳管必须补回 agent_run_events 唯一索引。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    engine = _make_engine(tmp_path)
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP INDEX IF EXISTS uq_agent_run_events_run_sequence")
        assert "uq_agent_run_events_run_sequence" not in _index_names(engine, "agent_run_events")

        db_session.bootstrap_sqlite_database(engine)

        assert "uq_agent_run_events_run_sequence" in _index_names(engine, "agent_run_events")
        assert migrations.current_revision(engine) == migrations.head_revision(engine)
    finally:
        engine.dispose()


def test_downgrade_roundtrip_on_latest_migration(tmp_path) -> None:
    """本波起迁移要求 downgrade 可用：head 的 down/up 往返必须在 SQLite 上跑通。"""

    engine = _make_engine(tmp_path)
    try:
        db_session.bootstrap_sqlite_database(engine)
        head = migrations.head_revision(engine)

        config = migrations.build_alembic_config(engine)
        with engine.connect() as conn:
            config.attributes["connection"] = conn
            command.downgrade(config, "-1")
        assert migrations.current_revision(engine) != head

        migrations.upgrade_head(engine)
        assert migrations.current_revision(engine) == head
    finally:
        engine.dispose()


def test_backup_retention_keeps_last_three(tmp_path) -> None:
    """备份保留最近 3 份，多余的按 mtime 淘汰。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    engine = _make_engine(tmp_path)
    try:
        Base.metadata.create_all(engine)
        for tag in ("0.0.1", "0.0.2", "0.0.3", "0.0.4", "0.0.5"):
            migrations.backup_sqlite_database(engine, tag=tag)
        backups = list(tmp_path.glob("storyforge.sqlite3.pre-alembic-*.bak"))
        assert len(backups) == 3, f"应只保留 3 份备份，实际 {sorted(b.name for b in backups)}"
    finally:
        engine.dispose()


def test_quick_check_failure_falls_back_to_create_all(tmp_path, monkeypatch) -> None:
    """quick_check 判定库损坏时中止纳管，回退 create_all 保证 sidecar 仍能起服（不 stamp）。"""

    import app.models  # noqa: F401
    from app.db.base import Base

    engine = _make_engine(tmp_path)
    try:
        Base.metadata.create_all(engine)  # 存量库形态，触发纳管路径
        monkeypatch.setattr(migrations, "quick_check", lambda _engine: (False, "corrupt"))

        db_session.bootstrap_sqlite_database(engine)

        assert inspect(engine).has_table("books"), "回退后库仍应可用"
        assert migrations.current_revision(engine) is None, "损坏库不应被 stamp 纳管"
    finally:
        engine.dispose()


def test_bootstrap_is_noop_for_non_sqlite() -> None:
    """非 sqlite 引擎直接返回，不触库连接（多 worker Postgres 部署不误动 schema）。"""

    fake_engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    # 不应抛错、不应调用 inspect（传入的假引擎无法被 inspect）。
    db_session.bootstrap_sqlite_database(fake_engine)  # type: ignore[arg-type]
