from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.main import app


@pytest.fixture(autouse=True)
def isolate_remote_llm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """清理会触发远程 Judge 的环境变量，保证 API 测试可重复。"""

    for name in (
        "STORYFORGE_JUDGE_LLM_API_KEY",
        "STORYFORGE_JUDGE_LLM_BASE_URL",
        "STORYFORGE_JUDGE_LLM_MODEL",
        "STORYFORGE_LLM_API_KEY",
        "STORYFORGE_LLM_BASE_URL",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """每个测试前重置限流计数器，避免跨用例污染。"""

    from app.main import _rate_store

    _rate_store.reset()


@pytest.fixture()
def engine() -> Generator:
    """每个测试使用独立内存数据库，避免跨用例污染。"""

    db_engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(db_engine)
    try:
        yield db_engine
    finally:
        Base.metadata.drop_all(db_engine)
        db_engine.dispose()


@pytest.fixture()
def session_factory(engine) -> sessionmaker[Session]:
    """提供与既有 API 测试一致的会话工厂。"""

    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


@pytest.fixture()
def session(session_factory: sessionmaker[Session]) -> Generator[Session, None, None]:
    """提供服务层测试使用的独立数据库会话。"""

    with session_factory() as db_session:
        yield db_session


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    """覆盖应用数据库依赖，使 API 测试完全本地可重复。"""

    def override_get_session() -> Generator[Session, None, None]:
        db_session = session_factory()
        try:
            yield db_session
        finally:
            db_session.close()

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app, headers={"X-StoryForge-API-Key": "local-dev-key"}) as test_client:
        yield test_client
    app.dependency_overrides.clear()
