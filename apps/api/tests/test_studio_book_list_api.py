from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.judge.models import JudgeIssue
from app.domains.workspaces.models import Workspace
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个测试使用独立内存数据库，避免污染其他任务数据。"""

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    """覆盖应用数据库依赖，使 Studio API 测试完全本地可重复。"""

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


def seed_book(
    session_factory: sessionmaker[Session],
    *,
    title: str,
    workspace_id: int | None = None,
    chapter_ordinals: list[int] | None = None,
) -> int:
    """创建 Studio 作品列表 API 所需的作品和章节事实。"""

    with session_factory() as session:
        book = Book(title=title, status="draft", premise="用于 Studio 作品列表。", workspace_id=workspace_id)
        session.add(book)
        session.flush()
        for ordinal in chapter_ordinals or []:
            session.add(Chapter(book_id=book.id, ordinal=ordinal, title=f"第 {ordinal} 章", status="planned"))
        session.commit()
        session.refresh(book)
        return book.id


def seed_workspace(session_factory: sessionmaker[Session], title: str) -> int:
    """创建工作区以验证作品列表的 int workspace_id 过滤。"""

    with session_factory() as session:
        workspace = Workspace(title=title, slug=title.lower(), status="active", seat_limit=5)
        session.add(workspace)
        session.commit()
        session.refresh(workspace)
        return workspace.id


def test_list_studio_books_returns_id_title_and_recent_chapter(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Studio 作品列表 API 返回作品 ID、标题和最近章节编号。"""

    book_id = seed_book(session_factory, title="星海纪元", chapter_ordinals=[1, 3, 2])

    response = client.get("/api/studio/books")

    assert response.status_code == 200, response.text
    books = response.json()
    assert books == [
        {
            "id": book_id,
            "title": "星海纪元",
            "recent_chapter_ordinal": 3,
        }
    ]


def test_list_studio_books_filters_by_workspace(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """workspace_id 使用现有 int 主键过滤作品列表。"""

    workspace_id = seed_workspace(session_factory, "alpha")
    kept_book_id = seed_book(session_factory, title="工作区内作品", workspace_id=workspace_id, chapter_ordinals=[1])
    seed_book(session_factory, title="其他作品", workspace_id=None, chapter_ordinals=[5])

    response = client.get(f"/api/studio/books?workspace_id={workspace_id}")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "id": kept_book_id,
            "title": "工作区内作品",
            "recent_chapter_ordinal": 1,
        }
    ]


def test_list_studio_books_returns_empty_list(client: TestClient) -> None:
    """没有作品时返回空列表，供 Studio 页面展示空态。"""

    response = client.get("/api/studio/books")

    assert response.status_code == 200, response.text
    assert response.json() == []



def test_read_studio_chapter_goal_returns_target_summary_and_constraints(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节目标 API 读取目标章节、上一章摘要和连续性约束。"""

    with session_factory() as session:
        book = Book(title="雾港航线", status="draft", premise="追查旧航线。")
        session.add(book)
        session.flush()
        previous = Chapter(book_id=book.id, ordinal=1, title="旧港线索", status="approved", summary="林岚确认旧港信号。")
        target = Chapter(book_id=book.id, ordinal=2, title="灯塔谈判", status="planned", summary="争取维修窗口。")
        session.add_all([previous, target])
        session.flush()
        session.add(
            ContinuityRecord(
                book_id=book.id,
                scene_id=None,
                record_type="next_chapter_constraints",
                subject="下一章继承约束",
                status="active",
                payload={"value": ["隐藏左臂旧伤", "副官留在门外"], "chapter_id": previous.id},
                version=1,
            )
        )
        session.commit()
        book_id = book.id

    response = client.get(f"/api/studio/chapter-goals?book_id={book_id}&target_ordinal=2")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "book_id": book_id,
        "target_chapter_id": target.id,
        "target_chapter_ordinal": 2,
        "target_chapter_title": "灯塔谈判",
        "chapter_goal": "争取维修窗口。",
        "previous_chapter_summary": "林岚确认旧港信号。",
        "continuity_constraints": ["隐藏左臂旧伤", "副官留在门外"],
    }



def test_read_studio_chapter_goal_returns_404_for_missing_target(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节目标不存在时返回 404，供 Web 展示可重试错误摘要。"""

    book_id = seed_book(session_factory, title="无目标章节作品", chapter_ordinals=[1])

    response = client.get(f"/api/studio/chapter-goals?book_id={book_id}&target_ordinal=2")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "章节目标不存在，无法读取 Studio 章节目标。"}



def test_read_studio_scene_packet_returns_packet_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Studio Scene Packet API 读取已组装包的证据和预算摘要。"""

    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="追查旧港信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=2, title="旧港谈判", status="draft", summary="争取维修窗口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="planned", content=None)
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(
            scene_id=scene.id,
            status="assembled",
            packet={
                "章节目标": "林岚争取维修窗口。",
                "证据链接": [{"source_ref": "asset:1"}, {"source_ref": "retrieval:1:1"}],
                "上下文预算": {"token_budget": 120, "used_tokens": 80, "truncated": False},
                "compiled_context_id": "ctx_unit_scene_packet",
            },
            version=1,
        )
        session.add(scene_packet)
        session.commit()
        book_id = book.id
        packet_id = scene_packet.id
        scene_id = scene.id

    response = client.get(f"/api/studio/scene-packets?book_id={book_id}&target_ordinal=2")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "book_id": book_id,
        "target_chapter_ordinal": 2,
        "scene_id": scene_id,
        "scene_packet_id": packet_id,
        "status": "assembled",
        "chapter_goal": "林岚争取维修窗口。",
        "evidence_count": 2,
        "compiled_context_id": "ctx_unit_scene_packet",
        "budget_summary": {"token_budget": 120, "used_tokens": 80, "truncated": False},
    }



def test_read_studio_scene_packet_returns_404_when_packet_missing(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Scene Packet 未组装时返回 404，供 Web 展示可重试错误摘要。"""

    book_id = seed_book(session_factory, title="暂无上下文包作品", chapter_ordinals=[1])

    response = client.get(f"/api/studio/scene-packets?book_id={book_id}&target_ordinal=1")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Scene Packet 不存在，无法读取 Studio Scene Packet。"}



def test_read_studio_judge_review_returns_review_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Studio Judge 评审 API 读取已持久化问题摘要，不触发 Repair。"""

    with session_factory() as session:
        book = Book(title="雾港评审", status="draft", premise="验证 Judge 摘要。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=3, title="港口审稿", status="draft", summary="检查草稿问题。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="旧港对峙", status="draft", content="林岚举起左臂完好无损。")
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"章节目标": "保持旧伤约束。"}, version=1)
        session.add(scene_packet)
        session.flush()
        issue = JudgeIssue(
            scene_id=scene.id,
            scene_packet_id=scene_packet.id,
            issue_type="setting_conflict",
            severity="high",
            status="open",
            description="正文与必含事实“左臂受伤”冲突。",
            payload={
                "span_start": 4,
                "span_end": 10,
                "recommended_repair_mode": "replace_span",
                "evidence_links": [{"source_ref": "asset://character/lin-lan#v1"}],
            },
        )
        session.add(issue)
        session.commit()
        scene_packet_id = scene_packet.id
        issue_id = issue.id

    response = client.get(f"/api/studio/judge-reviews?scene_packet_id={scene_packet_id}")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "scene_packet_id": scene_packet_id,
        "status": "open",
        "issue_count": 1,
        "highest_severity": "high",
        "score": 60,
        "issues": [
            {
                "id": issue_id,
                "category": "setting_conflict",
                "severity": "high",
                "summary": "正文与必含事实“左臂受伤”冲突。",
                "span_start": 4,
                "span_end": 10,
                "recommended_repair_mode": "replace_span",
            }
        ],
    }



def test_read_studio_judge_review_returns_404_when_review_missing(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Judge 评审不存在时返回 404，供 Web 展示可重试错误摘要。"""

    with session_factory() as session:
        book = Book(title="暂无评审作品", status="draft", premise="验证 Judge 缺失。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="待评审章节", status="draft", summary="等待评审。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="待评审场景", status="draft", content="草稿。")
        session.add(scene)
        session.flush()
        scene_packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"章节目标": "等待评审。"}, version=1)
        session.add(scene_packet)
        session.commit()
        scene_packet_id = scene_packet.id

    response = client.get(f"/api/studio/judge-reviews?scene_packet_id={scene_packet_id}")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Judge 评审不存在，无法读取 Studio Judge 评审。"}
