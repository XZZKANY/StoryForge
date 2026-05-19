from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.retrieval.schemas import RetrievalSourceCreate
from app.domains.retrieval.service import create_retrieval_source
from app.domains.scene_packets.schemas import ScenePacketCreate
from app.domains.scene_packets.service import assemble_scene_packet
from app.domains.series.models import Series

import pytest


@pytest.fixture()
def session() -> Generator[Session, None, None]:
    """使用 SQLite 内存库验证 Scene Packet 与 Context Compiler 接入。"""

    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    with factory() as db_session:
        yield db_session
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_scene_packet_records_compiled_context_debug_fields(session: Session) -> None:
    """Scene Packet 应输出 compiled_context_id、注入块、裁剪块和预算报告。"""

    series = Series(title="灯塔纪元", status="active", description="灯塔系列。")
    session.add(series)
    session.flush()
    book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=3, title="旧港谈判", status="draft", summary="林岚进入旧港谈判。")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content=None)
    session.add(scene)
    session.flush()
    character = Asset(
        book_id=book.id,
        scene_id=scene.id,
        asset_type="character",
        lineage_key="char-linlan-context",
        name="林岚",
        status="active",
        payload={"关系": "信任副官", "必须包含事实": ["左臂旧伤不能公开"]},
        version=1,
    )
    style = Asset(
        book_id=book.id,
        scene_id=None,
        asset_type="style_rule",
        lineage_key="style-context",
        name="克制文风",
        status="active",
        payload={"规则": "保持克制，不使用作者旁白解释。" * 30},
        version=1,
    )
    session.add_all([character, style])
    session.commit()
    create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            series_id=series.id,
            source_type="reference_doc",
            title="旧港协议",
            content_text="旧港协议要求谈判者隐藏舰队伤员。灯塔信号每七分钟重复一次。副官必须留在门外。",
            payload={"origin": "test"},
        ),
    )

    packet = assemble_scene_packet(
        session,
        ScenePacketCreate(
            book_id=book.id,
            chapter_id=chapter.id,
            scene_goal="林岚争取维修窗口并隐藏左臂旧伤。",
            active_asset_ids=[character.id, style.id],
            token_budget=95,
            user_intent="优先保留设定和检索证据。",
        ),
    )

    assert packet.packet["compiled_context_id"].startswith("ctx_")
    assert packet.packet["上下文注入"]
    assert packet.packet["上下文裁剪"]
    assert packet.packet["上下文预算"]["used_tokens"] <= packet.packet["上下文预算"]["token_budget"]
    retrieval_evidence = [link for link in packet.evidence_links if link.evidence_type == "retrieval_hit"]
    assert retrieval_evidence
    assert retrieval_evidence[0].source_id is not None
    assert retrieval_evidence[0].chunk_id is not None
    assert retrieval_evidence[0].score is not None
    assert retrieval_evidence[0].rank == 1
    assert retrieval_evidence[0].context_tokens is not None
    assert any(block["kind"] == "scene_goal" for block in packet.packet["上下文注入"])
    injected_retrieval = [block for block in packet.packet["上下文注入"] if block["kind"] == "retrieval_chunk"]
    assert injected_retrieval
    retrieval_metadata = injected_retrieval[0]["metadata"]
    assert retrieval_metadata["source_id"] == retrieval_evidence[0].source_id
    assert retrieval_metadata["chunk_id"] == retrieval_evidence[0].chunk_id
    assert retrieval_metadata["rank"] == 1
    assert retrieval_metadata["context_tokens"] == retrieval_evidence[0].context_tokens
    assert any("预算" in block["reason"] or "score_threshold" in block["reason"] for block in packet.packet["上下文裁剪"])
