from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book, Chapter, Scene
from app.domains.jobs.models import JobRun
from app.domains.workspaces.models import Workspace, WorkspaceMember
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
def commercial_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="商业化试点", slug="biz-team", status="active", description="额度测试", seat_limit=5)
        session.add(workspace)
        session.flush()
        session.add_all([
            WorkspaceMember(workspace_id=workspace.id, display_name="甲", role="owner", status="active"),
            WorkspaceMember(workspace_id=workspace.id, display_name="乙", role="editor", status="active"),
        ])
        book = Book(title="试点作品", status="draft", premise="商业控制", workspace_id=workspace.id)
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="章节一", status="draft", summary="摘要")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="场景一", status="draft", content="正文")
        session.add(scene)
        session.flush()
        session.add_all([
            JobRun(book_id=book.id, scene_id=scene.id, job_type="generate", status="completed", progress={"token_usage": 120}),
            JobRun(book_id=book.id, scene_id=scene.id, job_type="batch_refinery", status="completed", progress={"token_usage": 80}),
        ])
        session.commit()
        return {"workspace_id": workspace.id}


def test_commercial_policy_summary_reports_limit_usage(client: TestClient, commercial_context: dict[str, int]) -> None:
    policy_response = client.post(
        f"/api/commercial/workspaces/{commercial_context['workspace_id']}/policy",
        json={
            "plan_code": "team-basic",
            "seat_limit": 1,
            "monthly_job_limit": 1,
            "monthly_token_limit": 150,
            "monthly_price": 99,
        },
    )
    assert policy_response.status_code == 201, policy_response.text
    assert policy_response.json()["plan_code"] == "team-basic"

    summary_response = client.get(f"/api/commercial/workspaces/{commercial_context['workspace_id']}/summary")
    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["active_member_count"] == 2
    assert summary["current_job_count"] == 2
    assert summary["current_token_estimate"] == 200
    assert summary["within_limits"] is False
