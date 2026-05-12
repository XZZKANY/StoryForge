from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个评审修复测试使用独立内存数据库。"""

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
    """覆盖数据库依赖，确保 Judge/Repair API 完全本地可重复。"""

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
def story_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备章节、场景和上下文包，供结构化评审引用。"""

    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚在港口追查失真的灯塔信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="draft", content=None)
        session.add(scene)
        session.flush()
        packet = ScenePacket(
            scene_id=scene.id,
            status="assembled",
            packet={"必须包含事实": ["左臂受伤"], "风格规则": ["克制"]},
            version=1,
        )
        session.add(packet)
        session.commit()
        return {"scene_id": scene.id, "scene_packet_id": packet.id}


def test_judge_outputs_structured_issues_and_repair_returns_targeted_patch(
    client: TestClient,
    session_factory: sessionmaker[Session],
    story_context: dict[str, int],
) -> None:
    """章节片段同时出现设定冲突和文风漂移时，评审与修复都保持结构化。"""

    content = "林岚举起左臂，旁人看见左臂完好无损。作者直接解释这说明她早已摆脱旧伤，港口风声却仍很低。"
    evidence_links = [
        {
            "source_ref": "asset://character/lin-lan#v1",
            "rationale": "角色资产要求左臂仍受伤。",
        }
    ]

    judge_response = client.post(
        "/api/judge/issues",
        json={
            "scene_id": story_context["scene_id"],
            "scene_packet_id": story_context["scene_packet_id"],
            "content": content,
            "required_facts": ["左臂受伤"],
            "style_rules": ["克制"],
            "evidence_links": evidence_links,
        },
    )

    assert judge_response.status_code == 201, judge_response.text
    issues = judge_response.json()
    assert {issue["category"] for issue in issues} == {"setting_conflict", "style_drift"}
    for issue in issues:
        assert issue["severity"] in {"high", "medium"}
        assert content[issue["span_start"] : issue["span_end"]]
        assert issue["summary"]
        assert issue["evidence_links"] == evidence_links
        assert issue["recommended_repair_mode"] == "replace_span"
        assert issue["status"] == "open"

    setting_issue = next(issue for issue in issues if issue["category"] == "setting_conflict")
    repair_response = client.post(
        "/api/repair/patches",
        json={"issue_id": setting_issue["id"], "content": content},
    )

    assert repair_response.status_code == 201, repair_response.text
    patch = repair_response.json()
    target_span = content[setting_issue["span_start"] : setting_issue["span_end"]]
    assert patch["issue_id"] == setting_issue["id"]
    assert patch["target_span"] == target_span
    assert patch["target_span"] == "左臂完好无损"
    assert patch["replacement_text"] == "左臂仍然受伤"
    assert "港口风声却仍很低" not in patch["target_span"]
    assert "港口风声却仍很低" not in patch["replacement_text"]
    assert patch["reason"]
    assert patch["requires_rejudge"] is True

    with session_factory() as session:
        stored_issue = session.get(JudgeIssue, setting_issue["id"])
        stored_patch = session.scalars(select(RepairPatch)).one()

    assert stored_issue is not None
    assert stored_issue.status == "requires_rejudge"
    assert stored_patch.status == "requires_rejudge"
    assert stored_patch.patch["replacement_text"] == "左臂仍然受伤"
