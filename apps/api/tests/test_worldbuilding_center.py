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
    assert response.status_code == 404
