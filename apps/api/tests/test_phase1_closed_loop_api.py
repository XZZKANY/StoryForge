from __future__ import annotations

from collections.abc import Generator
from io import BytesIO
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.lineage_service import ChapterWritebackApproval, approve_chapter_writeback
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord
from app.domains.judge.models import RepairPatch
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每条闭环验收使用独立内存数据库，避免状态污染。"""

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
    """覆盖数据库依赖，让 FastAPI 路由在同一 SQLite 内存库中完成闭环。"""

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
def phase1_story(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """直接准备作品、两章和场景；当前阶段还没有作品创建路由。"""

    with session_factory() as session:
        book = Book(title="灯塔闭环", status="draft", premise="林岚追查失真的灯塔信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary="林岚抵达灯塔港。")
        next_chapter = Chapter(book_id=book.id, ordinal=2, title="余波", status="draft", summary="舰队离开灯塔港。")
        session.add_all([chapter, next_chapter])
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="planned", content=None)
        next_scene = Scene(chapter_id=next_chapter.id, ordinal=1, title="远航复盘", status="planned", content=None)
        session.add_all([scene, next_scene])
        session.commit()
        return {
            "book_id": book.id,
            "chapter_id": chapter.id,
            "scene_id": scene.id,
            "next_chapter_id": next_chapter.id,
            "next_scene_id": next_scene.id,
        }


def test_phase1_closed_loop_api_with_writeback_service_boundary(
    client: TestClient,
    session_factory: sessionmaker[Session],
    phase1_story: dict[str, int],
) -> None:
    """真实 API 串联第一阶段闭环；批准回写当前以服务层作为 Phase 1 边界。"""

    character = _create_asset(
        client,
        phase1_story["book_id"],
        phase1_story["scene_id"],
        "character",
        "林岚",
        {"关系": "信任副官", "必须包含事实": ["左臂受伤"]},
    )
    style = _create_asset(
        client,
        phase1_story["book_id"],
        None,
        "style_rule",
        "克制文风",
        {"规则": "保持克制", "必须规避事实": ["作者直接解释"]},
    )

    approval_response = client.post(
        "/api/continuity/chapter-approval",
        json={
            "chapter_id": phase1_story["chapter_id"],
            "previous_chapter_summary": "林岚发现灯塔信号每七分钟重复。",
            "character_state_changes": {"林岚": "左臂受伤但继续谈判"},
            "foreshadowing_changes": {"失真的灯塔信号": "仍未回收"},
            "style_drift": "保持克制，避免解释性旁白。",
            "next_chapter_constraints": ["林岚必须隐藏伤势", "灯塔信号仍需保留"],
        },
    )
    assert approval_response.status_code == 201, approval_response.text
    assert approval_response.json()["record_count"] == 5

    first_packet = _create_scene_packet(
        client,
        phase1_story["book_id"],
        phase1_story["chapter_id"],
        [character["id"], style["id"]],
        "林岚在港口谈判中争取维修窗口。",
    )
    assert "左臂受伤" in first_packet["packet"]["必须包含事实"]
    assert "林岚必须隐藏伤势" in first_packet["packet"]["必须包含事实"]

    draft_content = "林岚举起左臂，众人确认左臂完好无损。作者直接解释她已摆脱旧伤。"
    judge_response = client.post(
        "/api/judge/issues",
        json={
            "scene_id": first_packet["scene_id"],
            "scene_packet_id": first_packet["id"],
            "content": draft_content,
            "required_facts": first_packet["packet"]["必须包含事实"],
            "style_rules": [rule["rule"] for rule in first_packet["packet"]["风格规则"]],
            "evidence_links": first_packet["evidence_links"],
        },
    )
    assert judge_response.status_code == 201, judge_response.text
    issues = judge_response.json()
    assert {issue["category"] for issue in issues} == {"setting_conflict", "style_drift"}

    setting_issue = next(issue for issue in issues if issue["category"] == "setting_conflict")
    repair_response = client.post(
        "/api/repair/patches",
        json={"issue_id": setting_issue["id"], "content": draft_content},
    )
    assert repair_response.status_code == 201, repair_response.text
    patch = repair_response.json()
    assert patch["target_span"] == "左臂完好无损"
    assert patch["replacement_text"] == "左臂仍然受伤"

    approved_content = draft_content.replace(patch["target_span"], patch["replacement_text"]).replace(
        "作者直接解释她已摆脱旧伤。",
        "她把所有解释压回沉默里。",
    )
    with session_factory() as session:
        writeback = approve_chapter_writeback(
            session,
            ChapterWritebackApproval(
                book_id=phase1_story["book_id"],
                chapter_id=phase1_story["chapter_id"],
                approved_content=approved_content,
                diff_summary="采纳 Repair patch 并移除解释性旁白。",
                approved_by="Task 9 闭环测试",
                source_asset_ids=[character["id"]],
            ),
        )
        stored_patch = session.scalars(select(RepairPatch)).one()
        global_record = ContinuityRecord(
            book_id=phase1_story["book_id"],
            scene_id=None,
            record_type="next_chapter_constraints",
            subject="批准回写后的下一章继承约束",
            status="active",
            payload={"value": ["林岚必须隐藏伤势", "灯塔信号仍需保留"]},
            version=1,
        )
        session.add(global_record)
        session.commit()
    assert writeback.chapter_id == phase1_story["chapter_id"]
    assert stored_patch.status == "requires_rejudge"

    next_packet = _create_scene_packet(
        client,
        phase1_story["book_id"],
        phase1_story["next_chapter_id"],
        [style["id"]],
        "下一章复盘灯塔信号。",
    )
    assert "林岚必须隐藏伤势" in next_packet["packet"]["必须包含事实"]
    assert "灯塔信号仍需保留" in next_packet["packet"]["必须包含事实"]

    markdown_response = client.get(f"/api/books/{phase1_story['book_id']}/exports/markdown")
    assert markdown_response.status_code == 200, markdown_response.text
    assert "# 灯塔闭环" in markdown_response.text
    assert approved_content in markdown_response.text

    epub_response = client.get(f"/api/books/{phase1_story['book_id']}/exports/epub")
    assert epub_response.status_code == 200, epub_response.text
    assert epub_response.headers["content-type"] == "application/epub+zip"
    with ZipFile(BytesIO(epub_response.content)) as epub:
        content = epub.read("OEBPS/content.xhtml").decode("utf-8")
    assert "灯塔闭环" in content
    assert approved_content in content


def _create_asset(
    client: TestClient,
    book_id: int,
    scene_id: int | None,
    asset_type: str,
    name: str,
    payload: dict[str, object],
) -> dict:
    """通过真实资产 API 创建闭环所需资产。"""

    response = client.post(
        "/api/assets",
        json={
            "book_id": book_id,
            "scene_id": scene_id,
            "asset_type": asset_type,
            "name": name,
            "status": "active",
            "payload": payload,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_scene_packet(
    client: TestClient,
    book_id: int,
    chapter_id: int,
    asset_ids: list[int],
    scene_goal: str,
) -> dict:
    """通过真实 Scene Packet API 组装上下文包。"""

    response = client.post(
        "/api/scene-packets",
        json={
            "book_id": book_id,
            "chapter_id": chapter_id,
            "scene_goal": scene_goal,
            "active_asset_ids": asset_ids,
            "token_budget": 240,
            "user_intent": "验证第一阶段闭环状态继承。",
            "retrieval_snippets": ["灯塔信号每七分钟重复一次。"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()

