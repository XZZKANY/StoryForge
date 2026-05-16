from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
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
