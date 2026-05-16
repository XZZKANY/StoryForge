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
def collaboration_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="星海协作组", slug="xinghai-team", status="active", description="协作测试", seat_limit=3)
        session.add(workspace)
        session.flush()
        requester = WorkspaceMember(workspace_id=workspace.id, display_name="林岚", role="owner", status="active")
        reviewer = WorkspaceMember(workspace_id=workspace.id, display_name="顾潮", role="reviewer", status="active")
        session.add_all([requester, reviewer])
        session.flush()
        book = Book(title="灯塔余烬", status="draft", premise="追查信号", workspace_id=workspace.id)
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚进入旧港")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="林岚等待回应。")
        session.add(scene)
        session.commit()
        return {"workspace_id": workspace.id, "scene_id": scene.id, "requester_id": requester.id, "reviewer_id": reviewer.id}


def test_collaboration_comment_approval_timeline_and_events(client: TestClient, collaboration_context: dict[str, int]) -> None:
    comment_response = client.post(
        "/api/collaboration/comments",
        json={
            "workspace_id": collaboration_context["workspace_id"],
            "scene_id": collaboration_context["scene_id"],
            "member_id": collaboration_context["requester_id"],
            "body": "建议加强旧伤带来的动作限制。",
        },
    )
    assert comment_response.status_code == 201, comment_response.text

    approval_response = client.post(
        "/api/collaboration/approvals",
        json={
            "workspace_id": collaboration_context["workspace_id"],
            "scene_id": collaboration_context["scene_id"],
            "requester_member_id": collaboration_context["requester_id"],
            "reviewer_member_id": collaboration_context["reviewer_id"],
            "summary": "请确认旧伤设定是否已体现。",
        },
    )
    assert approval_response.status_code == 201, approval_response.text
    approval = approval_response.json()
    assert approval["status"] == "pending"

    decision_response = client.post(
        f"/api/collaboration/approvals/{approval['id']}/decisions",
        json={"member_id": collaboration_context["reviewer_id"], "decision": "approved", "note": "可以进入下一轮。"},
    )
    assert decision_response.status_code == 201, decision_response.text
    assert decision_response.json()["decision"] == "approved"

    timeline_response = client.get(f"/api/collaboration/scenes/{collaboration_context['scene_id']}/timeline")
    assert timeline_response.status_code == 200, timeline_response.text
    timeline = timeline_response.json()
    assert [item["item_type"] for item in timeline] == ["comment", "approval"]
    assert timeline[1]["status"] == "approved"

    events_response = client.get(f"/api/events/workspaces/{collaboration_context['workspace_id']}")
    assert events_response.status_code == 200, events_response.text
    event_types = [item["event_type"] for item in events_response.json()]
    assert event_types == ["approval_decided", "approval_requested", "comment_created"]
