from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.provider_gateway.runtime_config import load_runtime_provider_config
from app.domains.provider_gateway.service import ProviderGatewayError, resolve_provider
from app.domains.workspaces.models import Workspace
from app.main import app

import pytest


@pytest.fixture(autouse=True)
def clear_runtime_provider_config_cache() -> Generator[None, None, None]:
    """每个 provider 测试独立解析环境变量和 Redis 缓存，避免跨用例污染。"""

    from app.domains.provider_gateway import service as provider_service

    load_runtime_provider_config.cache_clear()
    provider_service.cache_delete_pattern("storyforge:provider-resolution:*")
    yield
    load_runtime_provider_config.cache_clear()
    provider_service.cache_delete_pattern("storyforge:provider-resolution:*")


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


def test_runtime_provider_config_uses_lru_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    """运行时 provider 环境配置应按能力缓存，并允许测试或运维显式清理。"""

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "deterministic")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "cached-writer")

    load_runtime_provider_config.cache_clear()
    first = load_runtime_provider_config("llm")
    second = load_runtime_provider_config("llm")
    cache_info = load_runtime_provider_config.cache_info()

    assert first is second
    assert cache_info.hits == 1
    assert cache_info.maxsize == 3

    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "cleared-writer")
    load_runtime_provider_config.cache_clear()
    refreshed = load_runtime_provider_config("llm")

    assert refreshed.model_name == "cleared-writer"



def test_provider_resolution_uses_redis_cache_and_invalidates_on_provider_create(
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Provider 解析应接入 Redis 缓存，并在新增 provider 后失效。"""

    from app.domains.provider_gateway import service as provider_service
    from app.domains.provider_gateway.schemas import ProviderConfigCreate

    cache_store: dict[str, dict] = {}
    deleted_patterns: list[str] = []

    def fake_get_json(key: str):
        return cache_store.get(key)

    def fake_set_json(key: str, value: dict, ttl_seconds: int) -> None:
        cache_store[key] = value

    def fake_delete_pattern(pattern: str) -> None:
        deleted_patterns.append(pattern)
        cache_store.clear()

    monkeypatch.setattr(provider_service, "cache_get_json", fake_get_json)
    monkeypatch.setattr(provider_service, "cache_set_json", fake_set_json)
    monkeypatch.setattr(provider_service, "cache_delete_pattern", fake_delete_pattern)

    with session_factory() as session:
        first = provider_service.resolve_provider(session, "llm")
        assert first.resolution_source in {"environment", "fallback"}
        assert cache_store

        cached_key = next(iter(cache_store))
        cached_payload = dict(cache_store[cached_key])
        cached_payload["provider_name"] = "cached-provider"
        cached_payload["resolution_summary"] = "来自 Redis 缓存。"
        cache_store[cached_key] = cached_payload

        second = provider_service.resolve_provider(session, "llm")
        assert second.provider_name == "cached-provider"
        assert second.resolution_summary == "来自 Redis 缓存。"

        provider_service.create_provider_config(
            session,
            ProviderConfigCreate(
                provider_name="openai-global",
                priority=10,
                capabilities=["llm"],
                model_aliases={"default": "gpt-5.5"},
                credential_ref="vault://global/openai",
            ),
        )

    assert deleted_patterns
    assert cache_store == {}
