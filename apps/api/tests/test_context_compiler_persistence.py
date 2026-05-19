from __future__ import annotations

from collections.abc import Generator

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.context_compiler.models import CompiledContextRecord
from app.domains.context_compiler.schemas import ContextBlock, ContextCompileRequest
from app.domains.context_compiler.service import compile_context, get_compiled_context_record, persist_compiled_context
from app.domains.scene_packets.schemas import ScenePacketCreate
from app.domains.scene_packets.service import assemble_scene_packet


@pytest.fixture()
def session() -> Generator[Session, None, None]:
    """使用 SQLite 内存库验证 compiled_contexts 最小持久化模型。"""

    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    with factory() as db_session:
        yield db_session
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_compiled_contexts_table_uses_existing_integer_foreign_keys(session: Session) -> None:
    """compiled_contexts 表必须跟随现有 int 主键体系。"""

    columns = inspect(session.bind).get_columns("compiled_contexts")
    column_types = {column["name"]: column["type"].__class__.__name__.lower() for column in columns}

    assert column_types["id"] == "integer"
    assert column_types["book_id"] == "integer"
    assert column_types["chapter_id"] == "integer"
    assert column_types["scene_id"] == "integer"
    assert "compiled_context_id" in column_types
    assert "block_refs" in column_types
    assert "budget_report" in column_types


def test_persist_compiled_context_saves_auditable_budget_and_block_refs(session: Session) -> None:
    """服务层应保存预算、注入块引用和裁剪摘要，而不是只返回临时 ID。"""

    book, chapter, scene = _create_book_chapter_scene(session)
    compiled = compile_context(_context_request(book.id, chapter.id, scene.id))
    record = persist_compiled_context(session, compiled)
    loaded = get_compiled_context_record(session, compiled.compiled_context_id)

    assert record.id is not None
    assert loaded is not None
    assert loaded.book_id == book.id
    assert loaded.chapter_id == chapter.id
    assert loaded.scene_id == scene.id
    assert loaded.token_budget == 80
    assert loaded.used_tokens == compiled.budget_report.used_tokens
    assert loaded.dropped_count == len(compiled.dropped_blocks)
    assert loaded.budget_report["truncated"] is True
    injected_refs = {block["block_id"] for block in loaded.block_refs["injected"]}
    dropped_refs = {block["block_id"] for block in loaded.block_refs["dropped"]}
    assert "goal" in injected_refs
    assert "style" in dropped_refs
    assert loaded.debug_summary == compiled.debug_summary


def test_scene_packet_assembly_persists_compiled_context_snapshot(session: Session) -> None:
    """Scene Packet 组装应让 compiled_context_id 可反查历史上下文快照。"""

    book, chapter, scene = _create_book_chapter_scene(session)
    asset = Asset(
        book_id=book.id,
        scene_id=scene.id,
        asset_type="character",
        lineage_key="char-linlan-compiled-context",
        name="林岚",
        status="active",
        payload={"关系": "信任副官", "必须包含事实": ["左臂旧伤不能公开"]},
        version=1,
    )
    session.add(asset)
    session.commit()

    packet = assemble_scene_packet(
        session,
        ScenePacketCreate(
            book_id=book.id,
            chapter_id=chapter.id,
            scene_goal="林岚争取维修窗口并隐藏旧伤。",
            active_asset_ids=[asset.id],
            token_budget=90,
            user_intent="优先保留设定。",
        ),
    )

    saved = session.scalar(
        select(CompiledContextRecord).where(
            CompiledContextRecord.compiled_context_id == packet.packet["compiled_context_id"]
        )
    )
    assert saved is not None
    assert saved.book_id == book.id
    assert saved.chapter_id == chapter.id
    assert saved.scene_id == scene.id
    assert saved.injected_count == len(packet.packet["上下文注入"])


def _create_book_chapter_scene(session: Session) -> tuple[Book, Chapter, Scene]:
    book = Book(title="上下文追溯", status="draft", premise="验证 compiled context。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=2, title="旧港", status="draft", summary="林岚抵达旧港。")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content=None)
    session.add(scene)
    session.commit()
    return book, chapter, scene


def _context_request(book_id: int, chapter_id: int, scene_id: int) -> ContextCompileRequest:
    return ContextCompileRequest(
        novel_id=book_id,
        chapter_id=chapter_id,
        scene_id=scene_id,
        token_budget=80,
        blocks=[
            ContextBlock(
                block_id="goal",
                kind="scene_goal",
                title="场景目标",
                content="林岚必须隐藏左臂旧伤。",
                source_ref="scene:1",
                token_count=20,
                priority="required",
                injection_position="scene",
            ),
            ContextBlock(
                block_id="memory",
                kind="memory_atom",
                title="角色记忆",
                content="林岚信任副官。",
                source_ref="memory:1",
                token_count=20,
                priority="high",
                injection_position="memory",
            ),
            ContextBlock(
                block_id="style",
                kind="style_rule",
                title="风格规则",
                content="保持克制，不使用作者旁白解释。" * 20,
                source_ref="style:1",
                token_count=60,
                priority="low",
                injection_position="style",
            ),
        ],
    )
