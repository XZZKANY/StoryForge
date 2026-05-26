from __future__ import annotations

from time import perf_counter

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import TimeoutError
from sqlalchemy.pool import QueuePool

from app.db import session as db_session


def test_build_engine_options_uses_postgresql_pool_defaults(monkeypatch) -> None:
    """PostgreSQL 连接应默认启用可配置连接池与连接存活检查。"""

    monkeypatch.delenv("STORYFORGE_DB_POOL_SIZE", raising=False)
    monkeypatch.delenv("STORYFORGE_DB_MAX_OVERFLOW", raising=False)
    monkeypatch.delenv("STORYFORGE_DB_POOL_PRE_PING", raising=False)
    monkeypatch.delenv("STORYFORGE_DB_POOL_TIMEOUT", raising=False)
    monkeypatch.delenv("STORYFORGE_DB_POOL_RECYCLE", raising=False)

    options_builder = getattr(db_session, "_build_engine_options", None)

    assert options_builder is not None
    assert options_builder("postgresql+psycopg://user:pass@localhost/db") == {
        "pool_size": 10,
        "max_overflow": 20,
        "pool_pre_ping": True,
        "pool_timeout": 30,
        "pool_recycle": 300,
    }


def test_build_engine_options_allows_environment_overrides(monkeypatch) -> None:
    """连接池参数允许本地部署通过环境变量调优。"""

    monkeypatch.setenv("STORYFORGE_DB_POOL_SIZE", "7")
    monkeypatch.setenv("STORYFORGE_DB_MAX_OVERFLOW", "3")
    monkeypatch.setenv("STORYFORGE_DB_POOL_PRE_PING", "false")
    monkeypatch.setenv("STORYFORGE_DB_POOL_TIMEOUT", "11")
    monkeypatch.setenv("STORYFORGE_DB_POOL_RECYCLE", "600")

    options_builder = getattr(db_session, "_build_engine_options", None)

    assert options_builder is not None
    assert options_builder("postgresql+psycopg://user:pass@localhost/db") == {
        "pool_size": 7,
        "max_overflow": 3,
        "pool_pre_ping": False,
        "pool_timeout": 11,
        "pool_recycle": 600,
    }


def test_build_engine_options_skips_pool_limits_for_sqlite(monkeypatch) -> None:
    """SQLite 测试替身不接收 QueuePool 专用参数，避免破坏本地测试。"""

    monkeypatch.setenv("STORYFORGE_DB_POOL_SIZE", "7")
    monkeypatch.setenv("STORYFORGE_DB_MAX_OVERFLOW", "3")
    monkeypatch.setenv("STORYFORGE_DB_POOL_PRE_PING", "true")
    monkeypatch.setenv("STORYFORGE_DB_POOL_TIMEOUT", "11")
    monkeypatch.setenv("STORYFORGE_DB_POOL_RECYCLE", "600")

    options_builder = getattr(db_session, "_build_engine_options", None)

    assert options_builder is not None
    assert options_builder("sqlite+pysqlite:///:memory:") == {}


def test_connection_pool_timeout_is_enforced_when_pool_is_exhausted(tmp_path) -> None:
    """连接池耗尽时，第三个连接请求必须在超时时间附近失败。"""

    database_path = tmp_path / "pool-timeout.sqlite3"
    engine = create_engine(
        f"sqlite+pysqlite:///{database_path}",
        poolclass=QueuePool,
        pool_size=2,
        max_overflow=0,
        pool_timeout=1,
    )

    first_connection = engine.connect()
    second_connection = engine.connect()
    started_at = perf_counter()
    try:
        with pytest.raises(TimeoutError):
            engine.connect()
    finally:
        first_connection.close()
        second_connection.close()
        engine.dispose()

    assert perf_counter() - started_at < 2.0


def test_get_engine_reads_database_url_lazily_and_caches(monkeypatch) -> None:
    """Engine 必须在首次使用时读取当前 DATABASE_URL，并缓存同一个连接池。"""

    calls: list[tuple[str, dict]] = []
    fake_engine = object()

    def fake_create_engine(database_url: str, **options: object) -> object:
        calls.append((database_url, options))
        return fake_engine

    get_engine = getattr(db_session, "get_engine", None)

    assert get_engine is not None
    get_engine.cache_clear()
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setattr(db_session, "create_engine", fake_create_engine)

    assert get_engine() is fake_engine
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@localhost/changed")
    assert get_engine() is fake_engine
    assert calls == [("sqlite+pysqlite:///:memory:", {})]
    get_engine.cache_clear()


def test_session_local_uses_lazy_engine_binding(monkeypatch) -> None:
    """SessionLocal() 保持可调用，并绑定首次使用时创建的 engine。"""

    get_engine = getattr(db_session, "get_engine", None)

    assert get_engine is not None
    get_engine.cache_clear()
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")

    session = db_session.SessionLocal()
    try:
        assert str(session.get_bind().url) == "sqlite+pysqlite:///:memory:"
    finally:
        session.close()
        get_engine().dispose()
        get_engine.cache_clear()



def test_get_session_rolls_back_and_closes_on_exception(monkeypatch) -> None:
    """请求处理抛出异常时，数据库会话必须先回滚再关闭。"""

    calls: list[str] = []

    class FakeSession:
        def rollback(self) -> None:
            calls.append("rollback")

        def close(self) -> None:
            calls.append("close")

    fake_session = FakeSession()
    monkeypatch.setattr(db_session, "SessionLocal", lambda: fake_session)

    provider = db_session.get_session()
    assert next(provider) is fake_session
    with pytest.raises(RuntimeError, match="boom"):
        provider.throw(RuntimeError("boom"))

    assert calls == ["rollback", "close"]
