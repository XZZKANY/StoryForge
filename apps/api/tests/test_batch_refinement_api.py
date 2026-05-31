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
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.series.models import StylePackApplication
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个批量精修 API 测试使用独立内存数据库。"""

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
    """覆盖数据库依赖，使批量精修 API 在同一 SQLite 内存库中执行。"""

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
def batch_scope(session_factory: sessionmaker[Session]) -> dict[str, object]:
    """准备作品、场景、风格包和连续性上下文，供批量精修调用。"""

    with session_factory() as session:
        book = Book(title="风暴回声", status="draft", premise="港口航线失真。")
        session.add(book)
        session.flush()

        chapter1 = Chapter(book_id=book.id, ordinal=1, title="裂港", status="draft", summary=None)
        chapter2 = Chapter(book_id=book.id, ordinal=2, title="回声", status="draft", summary=None)
        session.add_all([chapter1, chapter2])
        session.flush()

        scene1 = Scene(
            chapter_id=chapter1.id,
            ordinal=1,
            title="港口争执",
            status="draft",
            content="林岚看见左臂完好无损，海风仍在回荡。",
        )
        scene2 = Scene(
            chapter_id=chapter1.id,
            ordinal=2,
            title="旧伤说明",
            status="draft",
            content="她的左臂受伤，作者直接解释这只是旧伤复发。",
        )
        scene3 = Scene(
            chapter_id=chapter2.id,
            ordinal=1,
            title="灯塔夜航",
            status="draft",
            content="她的左臂受伤，灯塔只在远处闪烁。",
        )
        session.add_all([scene1, scene2, scene3])
        session.flush()

        style_pack = Asset(
            book_id=book.id,
            scene_id=None,
            asset_type="style_pack",
            lineage_key="style-pack-lineage",
            name="克制叙事",
            status="active",
            payload={
                "rules": ["保持克制"],
                "voice": "冷静、具画面感",
                "banned_phrases": ["作者直接解释"],
                "preferred_patterns": ["动作承载情绪"],
            },
            version=1,
        )
        session.add(style_pack)
        session.flush()

        application = StylePackApplication(
            style_pack_asset_id=style_pack.id,
            book_id=book.id,
            status="active",
            payload={"rules": ["保持克制"]},
            version=1,
        )
        session.add(application)

        packet1 = ScenePacket(
            scene_id=scene1.id,
            status="assembled",
            packet={"scene_goal": "争取维修窗口", "必须包含事实": ["左臂受伤"], "风格规则": ["克制"]},
            version=1,
        )
        packet2 = ScenePacket(
            scene_id=scene2.id,
            status="assembled",
            packet={"scene_goal": "说明旧伤", "必须包含事实": ["左臂受伤"], "风格规则": ["克制"]},
            version=1,
        )
        packet3 = ScenePacket(
            scene_id=scene3.id,
            status="assembled",
            packet={"scene_goal": "推进夜航", "必须包含事实": ["左臂受伤"], "风格规则": ["克制"]},
            version=1,
        )
        continuity_record = ContinuityRecord(
            book_id=book.id,
            scene_id=scene2.id,
            record_type="next_chapter_constraints",
            subject="左臂",
            status="active",
            payload={"value": ["左臂受伤"], "chapter_id": chapter1.id},
            version=1,
        )
        session.add_all([packet1, packet2, packet3, continuity_record])
        session.commit()
        return {
            "book_id": book.id,
            "scene_ids": [scene1.id, scene2.id, scene3.id],
            "style_pack_id": style_pack.id,
        }


def test_create_batch_refinement_job_generates_issues_patches_and_progress(
    client: TestClient,
    session_factory: sessionmaker[Session],
    batch_scope: dict[str, object],
) -> None:
    """批量精修应创建作业、逐场景评审并对有问题的场景生成补丁。"""

    response = client.post(
        "/api/batch-refinement/jobs",
        json={
            "book_id": batch_scope["book_id"],
            "scene_ids": batch_scope["scene_ids"],
            "mode": "rewrite",
            "required_facts": ["左臂受伤"],
            "style_rules": ["克制"],
        },
    )

    assert response.status_code == 201, response.text
    job = response.json()
    assert job["status"] == "completed"
    assert job["progress"]["total"] == 3
    assert job["progress"]["processed"] == 3
    assert job["progress"]["issue_count"] == 2
    assert job["progress"]["patch_count"] == 2
    assert len(job["issue_ids"]) == 2
    assert len(job["patch_ids"]) == 2

    job_run_id = job["job_run_id"]
    get_response = client.get(f"/api/batch-refinement/jobs/{job_run_id}")
    assert get_response.status_code == 200, get_response.text
    job_detail = get_response.json()
    assert job_detail["job_run_id"] == job_run_id
    assert job_detail["status"] == "completed"
    assert job_detail["progress"]["issue_count"] == 2
    assert job_detail["progress"]["patch_count"] == 2

    with session_factory() as session:
        stored_job = session.get(JobRun, job_run_id)
        issues = session.scalars(
            select(JudgeIssue).where(JudgeIssue.job_run_id == job_run_id).order_by(JudgeIssue.id)
        ).all()
        patches = session.scalars(
            select(RepairPatch).where(RepairPatch.job_run_id == job_run_id).order_by(RepairPatch.id)
        ).all()
        packets = session.scalars(
            select(ScenePacket).where(ScenePacket.job_run_id == job_run_id).order_by(ScenePacket.id)
        ).all()

    assert stored_job is not None
    assert stored_job.job_type == "batch_refinement"
    assert stored_job.status == "completed"
    assert stored_job.progress["total"] == 3
    assert stored_job.progress["issue_count"] == 2
    assert {issue.issue_type for issue in issues} == {"setting_conflict", "style_drift"}
    assert all(issue.status == "requires_rejudge" for issue in issues)
    assert len(patches) == 2
    assert len(packets) == 3
