from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.provider_gateway.service import ProviderGatewayError, resolve_provider
from app.domains.workspaces.models import Workspace
from app.main import app

import pytest


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    def override_get_session() -> Generator[Session, None, None]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def workspace_id(session_factory: sessionmaker[Session]) -> int:
    with session_factory() as session:
        workspace = Workspace(title="Provider 测试", slug="provider-team", status="active", description="provider", seat_limit=3)
        session.add(workspace)
        session.commit()
        return workspace.id


def test_provider_gateway_registers_and_resolves_capability(client: TestClient, workspace_id: int) -> None:
    global_provider = client.post(
        "/api/provider-gateway/providers",
        json={
            "provider_name": "openai-global",
            "priority": 50,
            "capabilities": ["llm", "embedding"],
            "model_aliases": {"writer": "gpt-5.5"},
            "credential_ref": "vault://global/openai",
        },
    )
    assert global_provider.status_code == 201, global_provider.text

    workspace_provider = client.post(
        "/api/provider-gateway/providers",
        json={
            "workspace_id": workspace_id,
            "provider_name": "anthropic-team",
            "priority": 10,
            "capabilities": ["llm"],
            "model_aliases": {"reviewer": "claude-sonnet"},
            "credential_ref": "vault://workspace/anthropic",
        },
    )
    assert workspace_provider.status_code == 201, workspace_provider.text

    listing = client.get("/api/provider-gateway/providers", params={"workspace_id": workspace_id})
    assert listing.status_code == 200, listing.text
    assert [item["provider_name"] for item in listing.json()] == ["anthropic-team", "openai-global"]

    resolution = client.get("/api/provider-gateway/resolve", params={"workspace_id": workspace_id, "capability": "llm"})
    assert resolution.status_code == 200, resolution.text
    result = resolution.json()
    assert result["provider_name"] == "anthropic-team"
    assert result["model_aliases"]["reviewer"] == "claude-sonnet"
    assert result["resolution_source"] == "database"


def test_provider_gateway_uses_environment_llm_when_key_configured(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """没有数据库 provider 时，LLM 能力读取环境变量中的真实 provider 配置。"""

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "gpt-5.5")
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_TIMEOUT_SECONDS", "45")
    monkeypatch.setenv("STORYFORGE_LLM_MAX_RETRIES", "3")

    with session_factory() as session:
        resolution = resolve_provider(session, "llm")

    assert resolution.provider_id is None
    assert resolution.provider_name == "openai"
    assert resolution.model_aliases["default"] == "gpt-5.5"
    assert resolution.model_aliases["timeout_seconds"] == 45
    assert resolution.model_aliases["max_retries"] == 3
    assert resolution.resolution_source == "environment"
    assert resolution.credential_status == "configured"


def test_provider_gateway_falls_back_by_capability_when_key_missing(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """真实 provider 未配置密钥时，按能力回退到确定性、本地或禁用实现。"""

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "gpt-5.5")
    monkeypatch.delenv("STORYFORGE_LLM_API_KEY", raising=False)
    monkeypatch.setenv("STORYFORGE_EMBEDDING_PROVIDER", "openai")
    monkeypatch.setenv("STORYFORGE_EMBEDDING_MODEL", "text-embedding-3-large")
    monkeypatch.delenv("STORYFORGE_EMBEDDING_API_KEY", raising=False)
    monkeypatch.setenv("STORYFORGE_RERANKER_PROVIDER", "cohere")
    monkeypatch.setenv("STORYFORGE_RERANKER_MODEL", "rerank-v3.5")
    monkeypatch.delenv("STORYFORGE_RERANKER_API_KEY", raising=False)

    with session_factory() as session:
        llm = resolve_provider(session, "llm")
        embedding = resolve_provider(session, "embedding")
        reranker = resolve_provider(session, "reranker")

    assert llm.provider_name == "deterministic"
    assert llm.model_aliases["configured_provider"] == "openai"
    assert embedding.provider_name == "local"
    assert embedding.model_aliases["configured_model"] == "text-embedding-3-large"
    assert reranker.provider_name == "disabled"
    assert reranker.model_aliases["configured_provider"] == "cohere"
    assert {llm.credential_status, embedding.credential_status, reranker.credential_status} == {"missing_fallback"}


def test_provider_gateway_rejects_unknown_capability(session_factory: sessionmaker[Session]) -> None:
    """Provider Gateway 只接受已区分的三类 Phase 5 能力。"""

    with session_factory() as session:
        with pytest.raises(ProviderGatewayError, match="llm、embedding、reranker"):
            resolve_provider(session, "vision")
