from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter
from app.domains.timeline.models import TimelineEventRecord
from app.domains.workspaces.models import Workspace


def _create_book_with_chapter(
    session_factory: sessionmaker[Session],
    *,
    title: str = "时间线闭环",
    chapter_ordinal: int = 1,
) -> dict[str, int]:
    """准备时间线事件所需的作品和章节真相源。"""

    with session_factory() as session:
        workspace = Workspace(
            title=f"{title}项目",
            slug=f"timeline-{uuid4().hex[:12]}",
            status="active",
            seat_limit=1,
        )
        session.add(workspace)
        session.flush()
        book = Book(
            title=title,
            status="draft",
            premise="验证 TimelineEvent。",
            workspace_id=workspace.id,
        )
        session.add(book)
        session.flush()
        chapter = Chapter(
            book_id=book.id,
            ordinal=chapter_ordinal,
            title=f"第 {chapter_ordinal} 章",
            status="draft",
            summary="时间线测试章节。",
        )
        session.add(chapter)
        session.commit()
        return {"project_id": workspace.id, "book_id": book.id, "chapter_id": chapter.id}


def test_create_timeline_event_persists_required_contract(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """创建 TimelineEvent 时必须持久化项目、作品、卷、章、顺序、摘要、证据和扩展载荷。"""

    scope = _create_book_with_chapter(session_factory)

    response = client.post(
        "/api/timeline-events",
        json={
            "project_id": scope["project_id"],
            "book_id": scope["book_id"],
            "volume_id": 2,
            "chapter_id": scope["chapter_id"],
            "time_order": 30,
            "summary": "林岚收到信号，api_key=secret-timeline-summary。",
            "evidence_refs": ["chapter:1:scene:1", "token=secret-timeline-evidence"],
            "payload": {"location": "灯塔港", "participants": ["林岚"]},
        },
    )

    assert response.status_code == 201, response.text
    event = response.json()
    assert event["id"] > 0
    assert event["project_id"] == scope["project_id"]
    assert event["book_id"] == scope["book_id"]
    assert event["volume_id"] == 2
    assert event["chapter_id"] == scope["chapter_id"]
    assert event["time_order"] == 30
    assert "secret-timeline-summary" not in event["summary"]
    assert "secret-timeline-evidence" not in event["evidence_refs"][1]
    assert event["payload"]["location"] == "灯塔港"
    assert event["created_at"]
    assert event["updated_at"]

    with session_factory() as session:
        stored = session.get(TimelineEventRecord, event["id"])
        assert stored is not None
        assert "secret-timeline-summary" not in stored.summary
        assert "secret-timeline-evidence" not in stored.evidence_refs[1]


def test_list_timeline_events_filters_book_and_orders_by_time(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """读取 TimelineEvent 列表时按作品过滤，并按 time_order 后 id 稳定排序。"""

    scope = _create_book_with_chapter(session_factory)
    other_scope = _create_book_with_chapter(session_factory, title="另一部作品", chapter_ordinal=1)

    for summary, time_order, target_scope in (
        ("后发生的事件", 20, scope),
        ("先发生的事件", 10, scope),
        ("其他作品事件", 5, other_scope),
    ):
        response = client.post(
            "/api/timeline-events",
            json={
                "project_id": target_scope["project_id"],
                "book_id": target_scope["book_id"],
                "volume_id": 1,
                "chapter_id": target_scope["chapter_id"],
                "time_order": time_order,
                "summary": summary,
                "evidence_refs": [f"chapter:{target_scope['chapter_id']}"],
                "payload": {},
            },
        )
        assert response.status_code == 201, response.text

    listing = client.get("/api/timeline-events", params={"book_id": scope["book_id"]})

    assert listing.status_code == 200, listing.text
    events = listing.json()
    assert [event["summary"] for event in events] == ["先发生的事件", "后发生的事件"]
    assert {event["book_id"] for event in events} == {scope["book_id"]}


def test_create_timeline_event_rejects_chapter_from_other_book(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节必须属于同一作品，避免时间线事件跨作品污染。"""

    scope = _create_book_with_chapter(session_factory)
    other_scope = _create_book_with_chapter(session_factory, title="错配作品", chapter_ordinal=1)

    response = client.post(
        "/api/timeline-events",
        json={
            "project_id": scope["project_id"],
            "book_id": scope["book_id"],
            "volume_id": 1,
            "chapter_id": other_scope["chapter_id"],
            "time_order": 1,
            "summary": "错误归属章节事件。",
            "evidence_refs": ["chapter:other"],
            "payload": {},
        },
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "章节不存在或不属于当前作品，无法创建时间线事件。"


def test_create_timeline_event_rejects_project_that_does_not_match_book_workspace(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """project_id 必须匹配作品 workspace_id，避免创建无法按项目查询到的漂移记录。"""

    with session_factory() as session:
        workspace = Workspace(title="时间线工作区", slug="timeline-workspace", status="active")
        other_workspace = Workspace(title="错项目", slug="timeline-other", status="active")
        session.add_all([workspace, other_workspace])
        session.flush()
        book = Book(
            title="时间线项目校验",
            status="draft",
            premise="验证项目作用域。",
            workspace_id=workspace.id,
        )
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="第 1 章", status="draft")
        session.add(chapter)
        session.commit()
        scope = {
            "book_id": book.id,
            "chapter_id": chapter.id,
            "other_project_id": other_workspace.id,
        }

    response = client.post(
        "/api/timeline-events",
        json={
            "project_id": scope["other_project_id"],
            "book_id": scope["book_id"],
            "volume_id": 1,
            "chapter_id": scope["chapter_id"],
            "time_order": 1,
            "summary": "错误项目作用域事件。",
            "evidence_refs": [],
            "payload": {},
        },
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "项目与作品工作区不匹配，无法创建时间线事件。"


def test_create_timeline_event_rejects_book_without_workspace(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        book = Book(title="无工作区作品", status="draft", premise="不能伪造项目归属。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="第 1 章", status="draft")
        session.add(chapter)
        session.commit()
        book_id = book.id
        chapter_id = chapter.id

    response = client.post(
        "/api/timeline-events",
        json={
            "project_id": 1,
            "book_id": book_id,
            "volume_id": 1,
            "chapter_id": chapter_id,
            "time_order": 1,
            "summary": "不应创建的事件。",
            "evidence_refs": [],
            "payload": {},
        },
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "项目与作品工作区不匹配，无法创建时间线事件。"
