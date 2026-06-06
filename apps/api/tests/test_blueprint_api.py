from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.books.models import Book, Chapter


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
    assert payload["chapter_goal"] == "发现异常并开始调查：林岚在雾港追查失真的灯塔信号。"


def test_chapter_plan_persists_lightweight_planning_arc_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节规划应把结构化弧线压缩为章节轻量引用和 Blueprint 摘要。"""

    book_id = seed_book(session_factory)
    created = client.post(
        "/api/blueprints",
        json={
            "book_id": book_id,
            "premise": "林岚在雾港追查失真的灯塔信号。",
            "tone": "克制悬疑",
            "target_word_count": 7500,
            "target_chapter_count": 5,
            "chapter_word_count_min": 1000,
            "chapter_word_count_max": 1800,
            "metadata": {
                "planning_arcs": [
                    {
                        "arc_id": "旧港信号",
                        "title": "旧港信号真相",
                        "target_chapters": [1, 2, 3],
                        "payoff_chapter": 3,
                    },
                    {
                        "arc_id": "灯塔许可",
                        "title": "灯塔许可代价",
                        "target_chapters": [4],
                        "payoff_chapter": 4,
                    },
                ],
            },
        },
    ).json()
    client.post(f"/api/blueprints/{created['id']}/lock")

    response = client.post(f"/api/blueprints/{created['id']}/chapter-plan")

    assert response.status_code == 200, response.text
    with session_factory() as session:
        blueprint = session.get(BookBlueprint, created["id"])
        assert blueprint is not None
        summary = blueprint.metadata_["planning_summary"]
        chapters = (
            session.query(Chapter)
            .filter(Chapter.book_id == book_id, Chapter.blueprint_id == created["id"])
            .order_by(Chapter.ordinal)
            .all()
        )

    assert summary == {
        "schema_version": 1,
        "arc_count": 2,
        "linked_chapter_count": 4,
        "target_chapter_count": 5,
        "arc_completion_ratio": 0.8,
        "chapter_arc_links": {
            "1": ["旧港信号"],
            "2": ["旧港信号"],
            "3": ["旧港信号"],
            "4": ["灯塔许可"],
        },
    }
    assert chapters[0].required_beats[-1] == "弧线推进：旧港信号真相"
    assert chapters[2].required_beats[-1] == "弧线推进：旧港信号真相"
    assert chapters[3].required_beats[-1] == "弧线推进：灯塔许可代价"
    assert all("planning_arcs" not in beat for chapter in chapters for beat in chapter.required_beats)


def test_chapter_plan_ignores_invalid_planning_arcs_and_deduplicates_targets(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节规划遇到坏弧线数据时应跳过无效项，并保留有效轻量引用。"""

    book_id = seed_book(session_factory)
    created = client.post(
        "/api/blueprints",
        json={
            "book_id": book_id,
            "premise": "林岚在雾港追查混乱的灯塔信号。",
            "tone": "克制悬疑",
            "target_word_count": 4500,
            "target_chapter_count": 3,
            "chapter_word_count_min": 1000,
            "chapter_word_count_max": 1800,
            "metadata": {
                "planning_arcs": [
                    "不是对象",
                    {
                        "arc_id": "   ",
                        "title": "空白弧线",
                        "target_chapters": [1],
                        "payoff_chapter": 1,
                    },
                    {
                        "arc_id": "回退标题",
                        "title": "   ",
                        "target_chapters": [1, 1, 0, 999, "2"],
                        "payoff_chapter": 1,
                    },
                    {
                        "arc_id": "有效弧线",
                        "title": "有效弧线标题",
                        "target_chapters": [2],
                    },
                ],
            },
        },
    ).json()
    client.post(f"/api/blueprints/{created['id']}/lock")

    response = client.post(f"/api/blueprints/{created['id']}/chapter-plan")

    assert response.status_code == 200, response.text
    with session_factory() as session:
        blueprint = session.get(BookBlueprint, created["id"])
        assert blueprint is not None
        summary = blueprint.metadata_["planning_summary"]
        chapters = (
            session.query(Chapter)
            .filter(Chapter.book_id == book_id, Chapter.blueprint_id == created["id"])
            .order_by(Chapter.ordinal)
            .all()
        )

    assert summary == {
        "schema_version": 1,
        "arc_count": 2,
        "linked_chapter_count": 2,
        "target_chapter_count": 3,
        "arc_completion_ratio": 0.67,
        "chapter_arc_links": {
            "1": ["回退标题"],
            "2": ["有效弧线"],
        },
    }
    assert chapters[0].required_beats.count("弧线推进：回退标题") == 1
    assert chapters[1].required_beats.count("弧线推进：有效弧线标题") == 1
    assert all("空白弧线" not in beat for chapter in chapters for beat in chapter.required_beats)
    assert all("弧线推进：" not in beat for beat in chapters[2].required_beats)


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
