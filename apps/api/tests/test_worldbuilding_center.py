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
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord
from app.domains.series.models import Series, SeriesMemory
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个世界观中心测试使用独立内存数据库。"""

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
    """覆盖数据库依赖，复用本地 TestClient 模式。"""

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
def world_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备系列、作品、资产和连续性记录作为世界观聚合输入。"""

    with session_factory() as session:
        series = Series(title="星海纪元", status="active", description="远航舰队系列。")
        session.add(series)
        session.flush()
        book = Book(title="灯塔余烬", status="draft", premise="舰队抵达灯塔港。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚抵达港口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="林岚隐瞒伤势。")
        session.add(scene)
        session.flush()
        assets = [
            Asset(book_id=book.id, scene_id=scene.id, asset_type="character", lineage_key="char-linlan", name="林岚", payload={"关系": "信任副官"}, version=1),
            Asset(book_id=book.id, scene_id=None, asset_type="location", lineage_key="loc-port", name="灯塔港", payload={"特征": "旧航线节点"}, version=1),
            Asset(book_id=book.id, scene_id=None, asset_type="organization", lineage_key="org-fleet", name="远航舰队", payload={"目标": "寻找新家园"}, version=1),
            Asset(book_id=book.id, scene_id=None, asset_type="foreshadowing", lineage_key="hook-signal", name="失真信号", payload={"状态": "未回收"}, version=1),
        ]
        session.add_all(assets)
        session.add(ContinuityRecord(book_id=book.id, scene_id=scene.id, record_type="next_chapter_constraints", subject="下一章继承约束", payload={"value": ["林岚必须隐藏伤势"], "chapter_id": chapter.id}, version=1))
        session.add_all(
            [
                SeriesMemory(series_id=series.id, memory_type="world_rule", lineage_key="rule-signal", subject="灯塔信号", payload={"规则": "灯塔信号每七分钟重复一次。"}, version=1),
                SeriesMemory(series_id=series.id, memory_type="cross_book_constraint", lineage_key="constraint-linlan", subject="林岚旧伤", payload={"约束": "旧伤必须影响后续谈判。"}, version=1),
            ]
        )
        session.commit()
        return {"series_id": series.id, "book_id": book.id}


def test_worldbuilding_center_aggregates_series_assets_and_continuity(
    client: TestClient,
    world_context: dict[str, int],
) -> None:
    """世界观中心聚合系列记忆、作品资产和连续性约束。"""

    response = client.get("/api/worldbuilding/center", params=world_context)
    assert response.status_code == 200, response.text
    result = response.json()

    assert result["series"]["title"] == "星海纪元"
    assert [item["name"] for item in result["characters"]] == ["林岚"]
    assert [item["name"] for item in result["locations"]] == ["灯塔港"]
    assert [item["name"] for item in result["organizations"]] == ["远航舰队"]
    assert result["world_rules"][0]["source"] == "series_memory"
    assert result["unresolved_foreshadowing"][0]["name"] == "失真信号"
    assert result["cross_book_constraints"][0]["subject"] == "林岚旧伤"
    assert "林岚必须隐藏伤势" in result["chapter_constraints"]
