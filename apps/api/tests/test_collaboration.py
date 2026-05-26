from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter, Scene
from app.domains.workspaces.models import Workspace, WorkspaceMember


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
    assert comment_response.status_code == 201
    comment = comment_response.json()
    assert comment["status"] == "open"
    assert comment["body"] == "建议加强旧伤带来的动作限制。"

    approval_response = client.post(
        "/api/collaboration/approvals",
        json={
            "workspace_id": collaboration_context["workspace_id"],
            "scene_id": collaboration_context["scene_id"],
            "requester_member_id": collaboration_context["requester_id"],
            "reviewer_member_id": collaboration_context["reviewer_id"],
            "summary": "请确认修订方案。",
        },
    )
    assert approval_response.status_code == 201
    approval = approval_response.json()
    assert approval["status"] == "pending"

    decision_response = client.post(
        f"/api/collaboration/approvals/{approval['id']}/decisions",
        json={
            "member_id": collaboration_context["reviewer_id"],
            "decision": "approved",
            "note": "同意。",
        },
    )
    assert decision_response.status_code == 201
    assert decision_response.json()["decision"] == "approved"

    timeline_response = client.get(f"/api/collaboration/scenes/{collaboration_context['scene_id']}/timeline")
    assert timeline_response.status_code == 200
    timeline = timeline_response.json()
    assert [item["item_type"] for item in timeline] == ["comment", "approval"]
    assert timeline[0]["summary"] == "建议加强旧伤带来的动作限制。"
    assert timeline[1]["status"] == "approved"
