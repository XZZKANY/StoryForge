from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord


def test_create_series_memory_and_read_worldbuilding_center(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """系列记忆和作品资产应共同进入世界观中心。"""

    series_response = client.post(
        "/api/series",
        json={"title": "群星三部曲", "description": "三代舰队穿越失落航道。"},
    )
    assert series_response.status_code == 201, series_response.text
    series = series_response.json()

    memory_response = client.post(
        f"/api/series/{series['id']}/memories",
        json={
            "memory_type": "world_rule",
            "subject": "灯塔港",
            "payload": {"规则": "灯塔港保存旧无线电协议，后续作品必须继承。"},
            "evidence": [
                {
                    "evidence_type": "chapter_fact",
                    "source_ref": "book:1/chapter:1",
                    "rationale": "第一部确立为系列规则。",
                }
            ],
        },
    )
    assert memory_response.status_code == 201, memory_response.text
    memory = memory_response.json()
    assert memory["version"] == 1
    assert memory["evidence"][0]["source_ref"] == "book:1/chapter:1"

    update_response = client.patch(
        f"/api/series/memories/{memory['id']}",
        json={"payload": {"规则": "灯塔港保存旧无线电协议，并隐藏禁区坐标。"}},
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["version"] == 2

    with session_factory() as session:
        book = Book(title="群星三部曲：第一部", status="draft", premise="舰队寻找新家园。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="灯塔港", status="draft", content="舰队靠港。")
        session.add(scene)
        session.flush()
        session.add_all(
            [
                Asset(
                    book_id=book.id,
                    scene_id=scene.id,
                    asset_type="location",
                    lineage_key="loc-lighthouse-port",
                    name="灯塔港",
                    status="active",
                    payload={"定义": "最后补给港，隐藏着旧无线电协议"},
                    version=1,
                ),
                ContinuityRecord(
                    book_id=book.id,
                    scene_id=scene.id,
                    record_type="next_chapter_constraints",
                    subject="灯塔港",
                    status="active",
                    payload={"value": ["后续章节必须继承旧无线电协议"], "chapter_id": chapter.id},
                    version=1,
                ),
            ]
        )
        session.commit()
        book_id = book.id

    summary_response = client.get(
        "/api/worldbuilding/center",
        params={"series_id": series["id"], "book_id": book_id},
    )
    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["series"]["title"] == "群星三部曲"
    assert summary["locations"][0]["name"] == "灯塔港"
    assert summary["world_rules"][0]["subject"] == "灯塔港"
    assert summary["chapter_constraints"] == ["后续章节必须继承旧无线电协议"]


def test_worldbuilding_center_rejects_missing_series(client: TestClient) -> None:
    """不存在的系列不能构建世界观中心。"""

    response = client.get("/api/worldbuilding/center", params={"series_id": 99999})
    assert response.status_code == 404
    assert response.json()["detail"] == "系列不存在，无法构建世界观中心。"
