from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book


def seed_book(session_factory: sessionmaker[Session]) -> int:
    """创建 blueprint API 所需的作品归属。"""

    with session_factory() as session:
        book = Book(title="雾港航线", status="draft", premise="调查旧港灯塔信号。")
        session.add(book)
        session.commit()
        session.refresh(book)
        return book.id


def test_create_read_and_lock_book_blueprint(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Blueprint API 应支持创建、读取和锁定最小全书蓝图。"""

    book_id = seed_book(session_factory)

    create_response = client.post(
        "/api/blueprints",
        json={
            "book_id": book_id,
            "premise": "林岚在雾港追查失真的灯塔信号。",
            "tone": "克制、悬疑、带有海雾质感",
            "target_word_count": 4500,
            "target_chapter_count": 3,
            "chapter_word_count_min": 1000,
            "chapter_word_count_max": 2000,
            "metadata": {"pov": "林岚"},
        },
    )

    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["book_id"] == book_id
    assert created["status"] == "draft"
    assert created["version"] == 1
    assert created["metadata"] == {"pov": "林岚"}

    read_response = client.get(f"/api/blueprints/{created['id']}")
    assert read_response.status_code == 200, read_response.text
    assert read_response.json()["premise"] == "林岚在雾港追查失真的灯塔信号。"

    lock_response = client.post(f"/api/blueprints/{created['id']}/lock")
    assert lock_response.status_code == 200, lock_response.text
    locked = lock_response.json()
    assert locked["status"] == "locked"
    assert locked["version"] == 2


def test_chapter_plan_requires_locked_blueprint(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """未锁定 blueprint 不能进入章节规划器。"""

    book_id = seed_book(session_factory)
    created = client.post(
        "/api/blueprints",
        json={
            "book_id": book_id,
            "premise": "林岚在雾港追查失真的灯塔信号。",
            "tone": "克制悬疑",
            "target_word_count": 3600,
            "target_chapter_count": 3,
            "chapter_word_count_min": 1000,
            "chapter_word_count_max": 1400,
        },
    ).json()

    response = client.post(f"/api/blueprints/{created['id']}/chapter-plan")

    assert response.status_code == 422, response.text
    assert response.json() == {"detail": "Blueprint 尚未锁定，不能触发章节规划。"}


def test_locked_blueprint_writes_chapter_plan_to_existing_chapters(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """锁定 Blueprint 触发规划后，应复用 chapters 表写入章节目标。"""

    book_id = seed_book(session_factory)
    created = client.post(
        "/api/blueprints",
        json={
            "book_id": book_id,
            "premise": "林岚在雾港追查失真的灯塔信号。",
            "tone": "克制悬疑",
            "target_word_count": 4500,
            "target_chapter_count": 3,
            "chapter_word_count_min": 1000,
            "chapter_word_count_max": 1800,
            "metadata": {"pov": "林岚", "location": "雾港"},
        },
    ).json()
    client.post(f"/api/blueprints/{created['id']}/lock")

    response = client.post(f"/api/blueprints/{created['id']}/chapter-plan")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "blueprint_id": created["id"],
        "book_id": book_id,
        "status": "planned",
        "chapter_count": 3,
    }

    chapter_goal = client.get(f"/api/studio/chapter-goals?book_id={book_id}&target_ordinal=1")
    assert chapter_goal.status_code == 200, chapter_goal.text
    payload = chapter_goal.json()
    assert payload["target_chapter_title"] == "雾港航线 1"
    assert payload["chapter_goal"] == "第 1 章推进：林岚在雾港追查失真的灯塔信号。"


def test_create_blueprint_rejects_missing_book(client: TestClient) -> None:
    """Blueprint 必须绑定已存在作品。"""

    response = client.post(
        "/api/blueprints",
        json={
            "book_id": 999,
            "premise": "不存在作品不能创建蓝图。",
            "tone": "克制",
            "target_word_count": 3600,
            "target_chapter_count": 3,
            "chapter_word_count_min": 1000,
            "chapter_word_count_max": 1400,
        },
    )

    assert response.status_code == 400, response.text
    assert response.json() == {"detail": "作品不存在，无法创建 Blueprint。"}
