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
def evaluation_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="Phase4 Eval Team", slug="phase4-eval-team", status="active", seat_limit=2)
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
        session.add_all([workspace, book])
        session.commit()
        return {"workspace_id": workspace.id, "book_id": book.id}


def test_evaluation_case_and_run_produce_metrics(client: TestClient, evaluation_scope: dict[str, int]) -> None:
    case = client.post(
        "/api/evaluations/cases",
        json={
            "workspace_id": evaluation_scope["workspace_id"],
            "book_id": evaluation_scope["book_id"],
            "case_name": "港口谈判一致性基准",
            "case_type": "consistency",
            "input_payload": {"scene_count": 2},
            "expected_payload": {"open_loop_count": 1},
        },
    )
    assert case.status_code == 201, case.text

    run = client.post(
        "/api/evaluations/runs",
        json={
            "case_id": case.json()["id"],
            "observed_payload": {
                "scene_count": 2,
                "open_issue_count": 1,
                "repair_attempts": 2,
                "repair_accepted": 1,
                "suggestions_total": 4,
                "suggestions_accepted": 2,
                "open_loop_count": 1,
            },
        },
    )
    assert run.status_code == 201, run.text
    result = run.json()
    assert result["metrics"]["consistency_error_rate"] == 0.5
    assert result["metrics"]["repair_success_rate"] == 0.5
    assert result["metrics"]["user_acceptance_rate"] == 0.5
    assert result["metrics"]["open_loop_count"] == 1

    listing = client.get("/api/evaluations/runs", params={"workspace_id": evaluation_scope["workspace_id"]})
    assert listing.status_code == 200
    assert len(listing.json()) == 1
