from __future__ import annotations

import pytest
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
