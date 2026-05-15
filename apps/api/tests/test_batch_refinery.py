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
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个批量精修测试使用独立内存数据库。"""

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
    """覆盖数据库依赖，确保批量精修完全本地可重复。"""

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
def batch_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备两个场景，其中一个会触发设定冲突修复。"""

    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        conflict_scene = Scene(
            chapter_id=chapter.id,
            ordinal=1,
            title="港口谈判",
            status="draft",
            content="林岚举起左臂，旁人看见左臂完好无损。",
        )
        clean_scene = Scene(
            chapter_id=chapter.id,
            ordinal=2,
            title="夜航复盘",
            status="draft",
            content="林岚按住左臂受伤处，克制地听完副官汇报。",
        )
        session.add_all([conflict_scene, clean_scene])
        session.commit()
        return {"book_id": book.id, "conflict_scene_id": conflict_scene.id, "clean_scene_id": clean_scene.id}


def test_batch_refinery_records_job_progress_issues_and_patches(
    client: TestClient,
    session_factory: sessionmaker[Session],
    batch_context: dict[str, int],
) -> None:
    """批量精修逐项执行评审和修复，并把明细写入 JobRun。"""

    response = client.post(
        "/api/batch-refinery/runs",
        json={
            "book_id": batch_context["book_id"],
            "items": [
                {
                    "scene_id": batch_context["conflict_scene_id"],
                    "content": "林岚举起左臂，旁人看见左臂完好无损。",
                    "required_facts": ["左臂受伤"],
                    "style_rules": ["克制"],
                },
                {
                    "scene_id": batch_context["clean_scene_id"],
                    "content": "林岚按住左臂受伤处，克制地听完副官汇报。",
                    "required_facts": ["左臂受伤"],
                    "style_rules": ["克制"],
                },
            ],
        },
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["status"] == "completed"
    assert result["progress"]["total"] == 2
    assert result["progress"]["succeeded"] == 2
    assert result["progress"]["failed"] == 0
    first_item = result["progress"]["items"][0]
    second_item = result["progress"]["items"][1]
    assert first_item["scene_id"] == batch_context["conflict_scene_id"]
    assert first_item["issue_ids"]
    assert first_item["repair_patch_id"] is not None
    assert second_item["scene_id"] == batch_context["clean_scene_id"]
    assert second_item["issue_ids"] == []
    assert second_item["repair_patch_id"] is None

    detail_response = client.get(f"/api/batch-refinery/runs/{result['id']}")
    assert detail_response.status_code == 200, detail_response.text
    assert detail_response.json()["progress"] == result["progress"]

    with session_factory() as session:
        job = session.get(JobRun, result["id"])
        issues = session.scalars(select(JudgeIssue).order_by(JudgeIssue.id)).all()
        patches = session.scalars(select(RepairPatch)).all()
    assert job is not None
    assert job.progress["items"][0]["repair_patch_id"] == patches[0].id
    assert len(issues) == 1
    assert len(patches) == 1


def test_batch_refinery_keeps_partial_failure_progress(
    client: TestClient,
    batch_context: dict[str, int],
) -> None:
    """单项失败时保留其他成功项，并返回可恢复的部分失败进度。"""

    response = client.post(
        "/api/batch-refinery/runs",
        json={
            "book_id": batch_context["book_id"],
            "items": [
                {"scene_id": batch_context["conflict_scene_id"], "content": "左臂完好无损", "required_facts": ["左臂受伤"]},
                {"scene_id": 99999, "content": "孤立片段", "required_facts": ["左臂受伤"]},
            ],
        },
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["status"] == "partial_failed"
    assert result["progress"]["succeeded"] == 1
    assert result["progress"]["failed"] == 1
    assert result["progress"]["items"][1]["status"] == "failed"
    assert "场景不存在" in result["progress"]["items"][1]["error"]
