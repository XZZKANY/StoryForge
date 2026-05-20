from __future__ import annotations

from app.db import session as db_session


def test_build_engine_options_uses_postgresql_pool_defaults(monkeypatch) -> None:
    """PostgreSQL 连接应默认启用可配置连接池与连接存活检查。"""

    monkeypatch.delenv("STORYFORGE_DB_POOL_SIZE", raising=False)
    monkeypatch.delenv("STORYFORGE_DB_MAX_OVERFLOW", raising=False)
    monkeypatch.delenv("STORYFORGE_DB_POOL_PRE_PING", raising=False)

    options_builder = getattr(db_session, "_build_engine_options", None)

    assert options_builder is not None
    assert options_builder("postgresql+psycopg://user:pass@localhost/db") == {
        "pool_size": 10,
        "max_overflow": 20,
        "pool_pre_ping": True,
    }


def test_build_engine_options_allows_environment_overrides(monkeypatch) -> None:
    """连接池参数允许本地部署通过环境变量调优。"""

    monkeypatch.setenv("STORYFORGE_DB_POOL_SIZE", "7")
    monkeypatch.setenv("STORYFORGE_DB_MAX_OVERFLOW", "3")
    monkeypatch.setenv("STORYFORGE_DB_POOL_PRE_PING", "false")

    options_builder = getattr(db_session, "_build_engine_options", None)

    assert options_builder is not None
    assert options_builder("postgresql+psycopg://user:pass@localhost/db") == {
        "pool_size": 7,
        "max_overflow": 3,
        "pool_pre_ping": False,
    }


def test_build_engine_options_skips_pool_limits_for_sqlite(monkeypatch) -> None:
    """SQLite 测试替身不接收 QueuePool 专用参数，避免破坏本地测试。"""

    monkeypatch.setenv("STORYFORGE_DB_POOL_SIZE", "7")
    monkeypatch.setenv("STORYFORGE_DB_MAX_OVERFLOW", "3")
    monkeypatch.setenv("STORYFORGE_DB_POOL_PRE_PING", "true")

    options_builder = getattr(db_session, "_build_engine_options", None)

    assert options_builder is not None
    assert options_builder("sqlite+pysqlite:///:memory:") == {}
