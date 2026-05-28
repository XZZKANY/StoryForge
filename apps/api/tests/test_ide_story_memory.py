from __future__ import annotations

from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from app.domains.books.models import Book
from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import create_memory_atom


def test_story_memory_query_filters_entity_fact_type_and_active_chapter(
    client: TestClient,
    session: Session,
) -> None:
    """IDE Story Memory 查询应支持实体、事实类型和章节有效区间过滤。"""

    book = Book(title="记忆浏览", status="draft", premise="验证 IDE 记忆查询。")
    session.add(book)
    session.commit()
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-old-status",
            novel_id=book.id,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="左臂完好",
            source_ref="chapter:1",
            valid_from_chapter=1,
            valid_to_chapter=3,
        ),
    )
    active = create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-current-status",
            novel_id=book.id,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="左臂有旧伤",
            source_ref="chapter:4",
            valid_from_chapter=4,
            confidence=0.91,
        ),
    )
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-location",
            novel_id=book.id,
            entity_type="location",
            entity_id="fogharbor",
            fact_type="location",
            value="雾港位于北岸",
            source_ref="chapter:2",
            valid_from_chapter=1,
        ),
    )

    response = client.post(
        "/api/ide/story-memory/query",
        json={"book_id": book.id, "entity_id": "linlan", "fact_type": "status", "chapter": 5},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["filters"] == {
        "book_id": book.id,
        "entity_type": None,
        "entity_id": "linlan",
        "fact_type": "status",
        "chapter": 5,
        "conflict_status": "all",
    }
    assert payload["total"] == 1
    assert payload["conflicted_count"] == 0
    assert payload["conflict_queue"] == []
    assert payload["items"][0]["memory_id"] == active.memory_id
    assert payload["items"][0]["value"] == "左臂有旧伤"
    assert payload["items"][0]["confidence"] == 0.91
    assert payload["items"][0]["conflict_ids"] == []


def test_story_memory_query_returns_conflict_queue_for_conflicted_filter(
    client: TestClient,
    session: Session,
) -> None:
    """conflict_status=conflicted 应只返回冲突事实并带冲突队列。"""

    book = Book(title="冲突记忆", status="draft", premise="验证 IDE 冲突队列。")
    session.add(book)
    session.commit()
    left = create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-public-mechanic",
            novel_id=book.id,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="公开身份是机械师",
            source_ref="chapter:2",
            valid_from_chapter=2,
            valid_to_chapter=8,
            immutable=True,
        ),
    )
    right = create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-public-commander",
            novel_id=book.id,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="公开身份是舰队指挥官",
            source_ref="agent:proposal",
            valid_from_chapter=4,
            valid_to_chapter=6,
        ),
    )
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-unrelated",
            novel_id=book.id,
            entity_type="character",
            entity_id="deputy",
            fact_type="relationship",
            value="信任林岚",
            source_ref="chapter:4",
            valid_from_chapter=1,
        ),
    )

    response = client.post(
        "/api/ide/story-memory/query",
        json={"book_id": book.id, "conflict_status": "conflicted"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 2
    assert payload["conflicted_count"] == 2
    assert {item["memory_id"] for item in payload["items"]} == {left.memory_id, right.memory_id}
    assert len(payload["conflict_queue"]) == 1
    conflict = payload["conflict_queue"][0]
    assert conflict["severity"] == "blocking"
    assert conflict["left_memory_id"] == left.memory_id
    assert conflict["right_memory_id"] == right.memory_id
    assert "重叠章节区间" in conflict["reason"]
    assert all(item["conflict_ids"] == [conflict["conflict_id"]] for item in payload["items"])


def test_story_memory_query_returns_empty_shape_for_unknown_book(client: TestClient) -> None:
    """没有匹配记忆时返回稳定空结构，供 Explorer 直接渲染空状态。"""

    response = client.post("/api/ide/story-memory/query", json={"book_id": 999})

    assert response.status_code == 200, response.text
    assert response.json() == {
        "filters": {
            "book_id": 999,
            "entity_type": None,
            "entity_id": None,
            "fact_type": None,
            "chapter": None,
            "conflict_status": "all",
        },
        "items": [],
        "conflict_queue": [],
        "total": 0,
        "conflicted_count": 0,
    }
