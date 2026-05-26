from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene


@pytest.fixture()
def packet_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚抵达港口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content=None)
        session.add(scene)
        session.flush()
        character = Asset(
            book_id=book.id,
            scene_id=scene.id,
            asset_type="character",
            lineage_key="char-linlan",
            name="林岚",
            status="active",
            payload={"关系": "信任副官", "必须包含事实": ["左臂受伤"]},
            version=1,
        )
        session.add(character)
        session.commit()
        return {"book_id": book.id, "chapter_id": chapter.id, "scene_id": scene.id, "character_id": character.id}


def test_scene_packet_can_auto_query_retrieval_hits(client: TestClient, packet_scope: dict[str, int]) -> None:
    source = client.post(
        "/api/retrieval/sources",
        json={
            "book_id": packet_scope["book_id"],
            "source_type": "approved_chapter",
            "title": "港口谈判资料",
            "content_text": "林岚必须隐藏伤势。灯塔信号每七分钟重复一次。旧协议决定谈判窗口。",
            "payload": {"origin": "approved_chapter"},
        },
    )
    assert source.status_code == 201, source.text

    response = client.post(
        "/api/scene-packets",
        json={
            "book_id": packet_scope["book_id"],
            "chapter_id": packet_scope["chapter_id"],
            "scene_goal": "林岚在港口谈判中争取维修窗口。",
            "active_asset_ids": [packet_scope["character_id"]],
            "token_budget": 220,
            "user_intent": "优先利用检索资料，不手工传 retrieval_snippets。",
            "retrieval_snippets": [],
        },
    )
    assert response.status_code == 201, response.text
    packet = response.json()
    assert packet["packet"]["检索片段"]
    assert packet["packet"]["检索命中"]
    retrieval_evidence = [link for link in packet["evidence_links"] if link["evidence_type"] == "retrieval_hit"]
    assert retrieval_evidence
    assert retrieval_evidence[0]["score"] is not None
    assert retrieval_evidence[0]["rank"] == 1


def test_retrieval_context_block_preserves_rerank_metadata() -> None:
    """Scene Packet 的检索上下文块应透传 reranker 证据，便于后续追溯排序来源。"""

    from app.domains.retrieval.schemas import RetrievalHitRead
    from app.domains.scene_packets.retrieval_bridge import retrieval_context_blocks
    from app.domains.scene_packets.schemas import ScenePacketCreate

    blocks = retrieval_context_blocks(
        ScenePacketCreate(
            book_id=1,
            chapter_id=1,
            scene_goal="验证检索重排证据。",
            active_asset_ids=[1],
            token_budget=120,
        ),
        [
            RetrievalHitRead(
                source_id=10,
                chunk_id=20,
                source_ref="retrieval:10:20",
                book_id=1,
                series_id=None,
                title="重排资料",
                excerpt="灯塔重排证据。",
                score=3.2,
                rank=1,
                score_source="rerank",
                keyword_score=1.0,
                embedding_score=0.8,
                rerank_score=1.4,
                rerank_provider="unit-reranker",
                rerank_model="unit-rerank-v1",
            )
        ],
    )

    assert blocks[0].metadata["rerank_score"] == 1.4
    assert blocks[0].metadata["rerank_provider"] == "unit-reranker"
    assert blocks[0].metadata["rerank_model"] == "unit-rerank-v1"
