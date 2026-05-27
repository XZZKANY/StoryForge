from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.blueprints.models import BookBlueprint
from app.domains.books.models import Book, Chapter, Scene
from app.domains.scene_packets.schemas import ScenePacketCreate
from app.domains.scene_packets.service import assemble_scene_packet


def test_scene_packet_injects_climax_pacing_directive_from_blueprint_metadata(session: Session) -> None:
    """Scene Packet 应按 Blueprint pacing_tag 为高潮章节注入节奏指令。"""

    book = Book(title="雾港长篇", status="draft", premise="林岚追查灯塔信号。")
    session.add(book)
    session.flush()
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="林岚在雾港追查失真的灯塔信号。",
        tone="克制悬疑",
        target_word_count=12000,
        target_chapter_count=5,
        chapter_word_count_min=1800,
        chapter_word_count_max=2600,
        status="locked",
        version=1,
        metadata_={"pacing_tag": {"3": "climax"}},
    )
    session.add(blueprint)
    session.flush()
    chapter = Chapter(
        book_id=book.id,
        ordinal=3,
        title="灯塔真相",
        status="draft",
        summary="林岚逼近灯塔核心。",
        blueprint_id=blueprint.id,
    )
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="灯塔对峙", status="draft", content=None)
    session.add(scene)
    session.flush()
    character = Asset(
        book_id=book.id,
        scene_id=scene.id,
        asset_type="character",
        lineage_key="char-linlan-pacing",
        name="林岚",
        status="active",
        payload={"关系": "信任副官"},
        version=1,
    )
    session.add(character)
    session.commit()

    packet = assemble_scene_packet(
        session,
        ScenePacketCreate(
            book_id=book.id,
            chapter_id=chapter.id,
            scene_goal="林岚在灯塔顶层逼问真相。",
            active_asset_ids=[character.id],
            token_budget=220,
            retrieval_snippets=["灯塔信号将在午夜达到峰值。"],
        ),
    )

    directive = packet.packet["pacing_directive"]
    assert directive["tag"] == "climax"
    assert "高潮" in directive["label"]
    assert "关键对抗" in directive["instruction"]
