from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter
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
            slug=f"timeline-{title}-{chapter_ordinal}-{id(session)}",
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
            "summary": "林岚在灯塔港收到第一封求救信号。",
            "evidence_refs": ["chapter:1:scene:1", "asset:signal"],
            "payload": {
                "location": "灯塔港",
                "participants": ["林岚"],
                "api_key": "secret-timeline-value",
            },
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
    assert event["summary"] == "林岚在灯塔港收到第一封求救信号。"
    assert event["evidence_refs"] == ["chapter:1:scene:1", "asset:signal"]
    assert event["payload"]["location"] == "灯塔港"
    assert event["payload"]["api_key"] == "[REDACTED]"
    assert "secret-timeline-value" not in response.text
    assert event["created_at"]
    assert event["updated_at"]


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


def test_create_timeline_event_rejects_project_from_other_book_scope(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    scope = _create_book_with_chapter(session_factory)
    other_scope = _create_book_with_chapter(session_factory, title="其他项目作品")

    response = client.post(
        "/api/timeline-events",
        json={
            "project_id": other_scope["project_id"],
            "book_id": scope["book_id"],
            "volume_id": 1,
            "chapter_id": scope["chapter_id"],
            "time_order": 1,
            "summary": "错误项目归属事件。",
            "evidence_refs": [],
            "payload": {},
        },
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "项目与作品归属不一致，无法创建时间线事件。"
