from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book
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
def prompt_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="Phase4 团队", slug="phase4-team", status="active", seat_limit=3)
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
        session.add_all([workspace, book])
        session.commit()
        return {"workspace_id": workspace.id, "book_id": book.id}


def test_prompt_pack_versioning_and_history(client: TestClient, prompt_scope: dict[str, int]) -> None:
    created = client.post(
        "/api/prompt-packs",
        json={
            "workspace_id": prompt_scope["workspace_id"],
            "book_id": prompt_scope["book_id"],
            "pack_type": "draft_writer",
            "name": "克制写作包",
            "payload": {"system": "保持克制", "forbidden": ["作者直接解释"], "scenes": ["谈判"]},
        },
    )
    assert created.status_code == 201, created.text
    pack = created.json()
    assert pack["version"] == 1

    updated = client.patch(
        f"/api/prompt-packs/{pack['id']}",
        json={"payload": {"system": "保持克制而具画面感", "forbidden": ["作者直接解释"], "scenes": ["谈判", "复盘"]}},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == 2

    listing = client.get("/api/prompt-packs", params={"workspace_id": prompt_scope["workspace_id"]})
    assert listing.status_code == 200
    assert len(listing.json()) == 1
    assert listing.json()[0]["version"] == 2

    history = client.get(f"/api/prompt-packs/{pack['id']}/history")
    assert history.status_code == 200
    assert [item["version"] for item in history.json()] == [1, 2]
