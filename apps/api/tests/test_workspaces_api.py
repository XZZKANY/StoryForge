from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
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


def test_create_workspace_add_members_and_enforce_seat_limit(client: TestClient) -> None:
    create_response = client.post(
        "/api/workspaces",
        json={"title": "星海协作组", "description": "第三阶段协作试点", "seat_limit": 1},
    )
    assert create_response.status_code == 201, create_response.text
    workspace = create_response.json()
    assert workspace["slug"] == "workspace" or workspace["slug"].startswith("workspace") is False

    first_member = client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"display_name": "林岚", "role": "owner", "status": "active"},
    )
    assert first_member.status_code == 201, first_member.text

    second_member = client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"display_name": "顾潮", "role": "reviewer", "status": "active"},
    )
    assert second_member.status_code == 400
    assert "席位已满" in second_member.json()["detail"]

    workspaces = client.get("/api/workspaces")
    assert workspaces.status_code == 200, workspaces.text
    assert workspaces.json()[0]["title"] == "星海协作组"

    members = client.get(f"/api/workspaces/{workspace['id']}/members")
    assert members.status_code == 200, members.text
    assert [item["display_name"] for item in members.json()] == ["林岚"]
