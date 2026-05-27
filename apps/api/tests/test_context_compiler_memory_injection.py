from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord
from app.domains.scene_packets.schemas import ScenePacketCreate
from app.domains.scene_packets.service import assemble_scene_packet
from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import create_memory_atom


def test_scene_packet_injects_recalled_story_memory_context(session: Session) -> None:
    """Scene Packet 应按 POV、地点、前章尾状态和活跃角色召回 story_memory。"""

    book = Book(title="雾港长篇", status="draft", premise="林岚追查灯塔信号。")
    session.add(book)
    session.flush()
    previous = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="approved", summary="林岚隐瞒左臂旧伤。")
    chapter = Chapter(
        book_id=book.id,
        ordinal=2,
        title="雾港谈判",
        status="draft",
        summary="林岚抵达雾港。",
        pov="林岚",
        location="雾港",
    )
    session.add_all([previous, chapter])
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="码头", status="draft", content=None)
    session.add(scene)
    session.flush()
    character = Asset(
        book_id=book.id,
        scene_id=scene.id,
        asset_type="character",
        lineage_key="char-linlan-memory",
        name="林岚",
        status="active",
        payload={"关系": "信任副官"},
        version=1,
    )
    session.add(character)
    session.add(
        ContinuityRecord(
            book_id=book.id,
            scene_id=None,
            record_type="next_chapter_constraints",
            subject="chapter:1",
            payload={"value": ["林岚必须继续隐藏左臂旧伤"]},
            status="active",
        )
    )
    session.commit()
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-linlan-status",
            novel_id=book.id,
            entity_type="character",
            entity_id="林岚",
            fact_type="status",
            value="林岚左臂有旧伤且不能公开。",
            source_ref=f"chapter:{previous.id}",
            valid_from_chapter=1,
            confidence=0.91,
        ),
    )
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-fogharbor-rule",
            novel_id=book.id,
            entity_type="location",
            entity_id="雾港",
            fact_type="rule",
            value="雾港码头的维修窗口只在午夜开放。",
            source_ref="world:雾港",
            valid_from_chapter=1,
            confidence=0.86,
        ),
    )
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-unrelated",
            novel_id=book.id,
            entity_type="character",
            entity_id="无关角色",
            fact_type="status",
            value="无关角色正在远方城市。",
            source_ref="chapter:1",
            valid_from_chapter=1,
        ),
    )

    packet = assemble_scene_packet(
        session,
        ScenePacketCreate(
            book_id=book.id,
            chapter_id=chapter.id,
            scene_goal="林岚在雾港码头争取维修窗口。",
            active_asset_ids=[character.id],
            token_budget=220,
            user_intent="突出旧伤和地点约束。",
            retrieval_snippets=["雾港维修条例要求午夜登记。"],
        ),
    )

    memory_context = packet.packet["memory_context"]
    assert [item["entity_id"] for item in memory_context] == ["林岚", "雾港"]
    assert all(item["source_ref"] for item in memory_context)
    assert "无关角色" not in {item["entity_id"] for item in memory_context}
    injected_memory = [block for block in packet.packet["上下文注入"] if block["kind"] == "memory_atom"]
    injected_sources = {block["source_ref"] for block in injected_memory}
    assert {item["memory_id"] for item in memory_context}.issubset(injected_sources)
    assert any("林岚必须继续隐藏左臂旧伤" in block["content"] for block in packet.packet["上下文注入"])
