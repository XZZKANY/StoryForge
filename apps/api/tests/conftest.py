from __future__ import annotations

import os
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
        "STORYFORGE_LLM_API_BASE_URL",
        "STORYFORGE_LLM_MODEL",
        "STORYFORGE_LLM_PROVIDER",
        "STORYFORGE_LLM_TEMPERATURE",
        "STORYFORGE_LLM_TIMEOUT_SECONDS",
        "STORYFORGE_LLM_MAX_COMPLETION_TOKENS",
        "STORYFORGE_LLM_REASONING_EFFORT",
        "STORYFORGE_LLM_AUTH_HEADER",
        "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS",
        "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS",
        "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS",
        "STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS",
        "STORYFORGE_LLM_SMOKE_RECAP_FULL_CHAPTERS",
        "STORYFORGE_LLM_SMOKE_FAST_JUDGE",
        "STORYFORGE_LLM_CONFIG_FILE",
    ):
        monkeypatch.delenv(name, raising=False)

    # 仅清 os.environ 不够：resolved_llm_env 还会从 pydantic settings（.env/.env.local）
    # 回填 LLM 配置。本机配了真实 key 时会让 chat.explain/修订默认走真·LLM 并挂在网络请求上，
    # 破坏测试可重复性。这里把缓存 settings 的 LLM 字段一并清空，使默认判定为「未配置」；
    # 需要真实路径的测试仍可用 monkeypatch 覆盖 missing_book_generation_env / get_settings。
    from app.common.config import get_settings

    settings = get_settings()
    for attr in (
        "storyforge_llm_api_key",
        "storyforge_llm_base_url",
        "storyforge_llm_api_base_url",
        "storyforge_llm_model",
        "storyforge_llm_provider",
    ):
        if hasattr(settings, attr):
            monkeypatch.setattr(settings, attr, "", raising=False)


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """每个测试前重置限流计数器，避免跨用例污染。"""

    from app.main import _rate_store

    reset = getattr(_rate_store, "reset", None)
    if callable(reset):
        reset()


@pytest.fixture(autouse=True)
def _reset_domain_caches() -> None:
    """每个测试前清理领域缓存，避免内存数据库 ID 重置后读到旧聚合。"""

    from app.domains.worldbuilding.service import invalidate_worldbuilding_cache

    invalidate_worldbuilding_cache()


@pytest.fixture(autouse=True)
def _disable_s3_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认禁用 S3 客户端，避免测试尝试连接真实 MinIO；需要时显式打桩。"""

    monkeypatch.setattr("app.common.s3_client.get_s3_client", lambda: None)


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
    api_key = os.getenv("STORYFORGE_API_KEY", "local-dev-key")
    with TestClient(app, headers={"X-StoryForge-API-Key": api_key}) as test_client:
        yield test_client
    app.dependency_overrides.clear()
