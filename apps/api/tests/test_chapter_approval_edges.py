from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityEdge, ContinuityRecord


@pytest.fixture()
def chapter_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查失真的灯塔信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary="林岚抵达港口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="draft", content="正文")
        session.add(scene)
        session.commit()
        return {"book_id": book.id, "chapter_id": chapter.id, "scene_id": scene.id}


def _approval_body(chapter_id: int, edges: list[dict] | None = None) -> dict:
    body = {
        "chapter_id": chapter_id,
        "previous_chapter_summary": "上一章林岚发现灯塔信号异常。",
        "character_state_changes": {"林岚": "左臂受伤"},
        "foreshadowing_changes": {"失真的灯塔信号": "仍未回收"},
        "style_drift": "保持克制。",
        "next_chapter_constraints": ["林岚必须隐藏伤势"],
    }
    if edges is not None:
        body["continuity_edges"] = edges
    return body


def test_approval_with_valid_edges_persists(
    client: TestClient,
    session_factory: sessionmaker[Session],
    chapter_context: dict[str, int],
) -> None:
    """批准带合法边 → 201，边落库，edge_count 正确。"""

    edges = [
        {"edge_kind": "relationship", "subject_ref": "character:林岚", "predicate": "父", "object_ref": "character:林父"},
        {"edge_kind": "timeline_order", "subject_ref": "event:出海", "predicate": "早于", "object_ref": "event:爆炸"},
    ]
    resp = client.post("/api/continuity/chapter-approval", json=_approval_body(chapter_context["chapter_id"], edges))
    assert resp.status_code == 201, resp.text
    assert resp.json()["continuity_edge_count"] == 2

    with session_factory() as session:
        stored = session.scalars(
            select(ContinuityEdge).where(ContinuityEdge.book_id == chapter_context["book_id"])
        ).all()
    assert len(stored) == 2


def test_approval_persists_default_edge_window_as_chapter_ordinal(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """未显式给 valid_from_chapter 时，校验与落库都应使用当前章节序号。"""

    with session_factory() as session:
        book = Book(title="边窗口归一化", status="draft", premise="验证边生效章节。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=7, title="第七章", status="draft", summary="归一化测试。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="第七章场景", status="draft", content="正文")
        session.add(scene)
        session.commit()
        book_id = book.id
        chapter_id = chapter.id

    edges = [
        {"edge_kind": "status", "subject_ref": "character:林岚", "predicate": "所在地", "object_ref": "灯塔港"},
    ]
    resp = client.post("/api/continuity/chapter-approval", json=_approval_body(chapter_id, edges))
    assert resp.status_code == 201, resp.text

    with session_factory() as session:
        stored = session.scalars(select(ContinuityEdge).where(ContinuityEdge.book_id == book_id)).one()
    assert stored.valid_from_chapter == 7


def test_approval_without_edges_unchanged(
    client: TestClient,
    session_factory: sessionmaker[Session],
    chapter_context: dict[str, int],
) -> None:
    """旧调用方不传 continuity_edges → 行为与改前一致，零边落库。"""

    resp = client.post("/api/continuity/chapter-approval", json=_approval_body(chapter_context["chapter_id"]))
    assert resp.status_code == 201, resp.text
    assert resp.json()["record_count"] == 5
    assert resp.json()["continuity_edge_count"] == 0
    with session_factory() as session:
        edges = session.scalars(select(ContinuityEdge)).all()
    assert edges == []


def test_approval_rejects_relationship_cycle(
    client: TestClient,
    session_factory: sessionmaker[Session],
    chapter_context: dict[str, int],
) -> None:
    """成环边 → 409，事务回滚（records 与 edges 均未落库）。"""

    edges = [
        {"edge_kind": "relationship", "subject_ref": "character:A", "predicate": "父", "object_ref": "character:B"},
        {"edge_kind": "relationship", "subject_ref": "character:B", "predicate": "父", "object_ref": "character:A"},
    ]
    resp = client.post("/api/continuity/chapter-approval", json=_approval_body(chapter_context["chapter_id"], edges))
    assert resp.status_code == 409, resp.text
    assert "成环" in resp.json()["detail"]

    with session_factory() as session:
        edges_stored = session.scalars(select(ContinuityEdge)).all()
        records = session.scalars(
            select(ContinuityRecord).where(ContinuityRecord.book_id == chapter_context["book_id"])
        ).all()
    assert edges_stored == []
    assert records == []  # 整笔事务回滚，连续性记录也未落库


def test_approval_rejects_timeline_inversion(
    client: TestClient,
    chapter_context: dict[str, int],
) -> None:
    """时间线倒错边 → 409。"""

    edges = [
        {"edge_kind": "timeline_order", "subject_ref": "event:X", "predicate": "早于", "object_ref": "event:Y"},
        {"edge_kind": "timeline_order", "subject_ref": "event:Y", "predicate": "早于", "object_ref": "event:X"},
    ]
    resp = client.post("/api/continuity/chapter-approval", json=_approval_body(chapter_context["chapter_id"], edges))
    assert resp.status_code == 409, resp.text
    assert "时间线倒错" in resp.json()["detail"]


def test_approval_rejects_status_window_conflict(
    client: TestClient,
    session_factory: sessionmaker[Session],
    chapter_context: dict[str, int],
) -> None:
    """已死亡（40 章起）与活动（候选 45 章）时间窗重叠 → 409。"""

    with session_factory() as session:
        session.add(
            ContinuityEdge(
                book_id=chapter_context["book_id"],
                edge_kind="status",
                subject_ref="character:林岚",
                predicate="生死",
                object_ref="已死亡",
                valid_from_chapter=40,
                valid_to_chapter=None,
            )
        )
        session.commit()

    edges = [
        {
            "edge_kind": "status",
            "subject_ref": "character:林岚",
            "predicate": "生死",
            "object_ref": "活动",
            "valid_from_chapter": 45,
        }
    ]
    resp = client.post("/api/continuity/chapter-approval", json=_approval_body(chapter_context["chapter_id"], edges))
    assert resp.status_code == 409, resp.text
    assert "时间窗冲突" in resp.json()["detail"]


def test_approval_rejects_same_batch_self_contradiction(
    client: TestClient,
    chapter_context: dict[str, int],
) -> None:
    """同一批内 A→B 与 B→A → 累积校验抓到环 → 409。"""

    edges = [
        {"edge_kind": "relationship", "subject_ref": "character:A", "predicate": "属下", "object_ref": "character:B"},
        {"edge_kind": "relationship", "subject_ref": "character:B", "predicate": "属下", "object_ref": "character:A"},
    ]
    resp = client.post("/api/continuity/chapter-approval", json=_approval_body(chapter_context["chapter_id"], edges))
    assert resp.status_code == 409, resp.text
