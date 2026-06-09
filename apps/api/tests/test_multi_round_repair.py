from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.phase9b_real_llm_smoke import MAX_REPAIR_ROUNDS, REPAIR_THRESHOLD, _judge_and_repair_loop
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.schemas import CharacterBibleCreate
from app.domains.character_bible.service import create_character_bible_entry
from app.domains.continuity.models import ScenePacket


def _create_test_book_run(session: Session, book: Book) -> BookRun:
    """创建测试用的最小 BookRun（需要 blueprint_id）。"""
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="测试",
        tone="测试",
        target_word_count=1000,
        target_chapter_count=1,
        chapter_word_count_min=500,
        chapter_word_count_max=1500,
        status="locked",
        version=1,
    )
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)

    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="running",
        total_chapters=1,
        tokens_used=0,
        estimated_cost=0.0,
        progress={},
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)
    return book_run


def test_judge_and_repair_loop_performs_multiple_rounds_when_issues_persist(session: Session) -> None:
    """多轮修复循环应在每轮修复后 rejudge，直到 score ≥ 阈值或达到最大轮数。"""

    book = Book(title="多轮修复测试", status="draft", premise="测试多轮修复")
    session.add(book)
    session.commit()
    session.refresh(book)

    create_character_bible_entry(
        session,
        CharacterBibleCreate(
            book_id=book.id,
            canonical_name="测试角色",
            aliases=[],
            voice_traits={},
            forbidden_traits={
                "禁止": ["词A", "词B", "词C"],
                "替换": {"词A": "替换A", "词B": "替换B", "词C": "替换C"},
            },
        ),
    )

    chapter = Chapter(book_id=book.id, ordinal=1, title="测试章节", status="approved")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title="测试场景",
        status="approved",
        content="这段正文包含词A和词B还有词C，应该触发多轮修复。",
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)

    scene_packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"test": True},
        version=1,
    )
    session.add(scene_packet)
    session.commit()
    session.refresh(scene_packet)

    book_run = _create_test_book_run(session, book)

    outcome = _judge_and_repair_loop(session, {}, book_run, scene, scene_packet)

    assert outcome["repair_rounds"] >= 1, "应至少触发一轮修复（检测到词A/B/C）"
    assert outcome["quality_score"] >= REPAIR_THRESHOLD, "修复后 score 应 ≥ 阈值（循环停止条件）"
    assert len(outcome["repair_patch_ids"]) == outcome["repair_rounds"], "repair_patch_ids 长度应等于修复轮数"

    session.refresh(scene)
    violations_remaining = sum(1 for word in ["词A", "词B", "词C"] if word in scene.content)
    assert violations_remaining < 3, "至少一个禁止词应被修复"


def test_judge_and_repair_loop_stops_at_max_rounds(session: Session) -> None:
    """多轮修复循环应在达到 MAX_REPAIR_ROUNDS 时停止，即使仍有问题。"""

    book = Book(title="最大轮数测试", status="draft", premise="测试最大轮数")
    session.add(book)
    session.commit()
    session.refresh(book)

    create_character_bible_entry(
        session,
        CharacterBibleCreate(
            book_id=book.id,
            canonical_name="测试角色",
            aliases=[],
            voice_traits={},
            forbidden_traits={
                "禁止": ["词A", "词B", "词C", "词D"],
                "替换": {"词A": "A", "词B": "B", "词C": "C", "词D": "D"},
            },
        ),
    )

    chapter = Chapter(book_id=book.id, ordinal=1, title="测试章节", status="approved")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title="测试场景",
        status="approved",
        content="这段正文包含词A、词B、词C和词D，超过最大修复轮数。",
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)

    scene_packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"test": True},
        version=1,
    )
    session.add(scene_packet)
    session.commit()
    session.refresh(scene_packet)

    book_run = _create_test_book_run(session, book)

    outcome = _judge_and_repair_loop(session, {}, book_run, scene, scene_packet)

    assert outcome["repair_rounds"] <= MAX_REPAIR_ROUNDS, f"修复轮数不应超过 {MAX_REPAIR_ROUNDS}"
    assert len(outcome["repair_patch_ids"]) <= MAX_REPAIR_ROUNDS, "repair_patch_ids 长度不应超过最大轮数"


def test_judge_and_repair_loop_stops_when_score_above_threshold(session: Session) -> None:
    """多轮修复循环应在 quality_score ≥ REPAIR_THRESHOLD 时停止。"""

    book = Book(title="阈值测试", status="draft", premise="测试阈值停止")
    session.add(book)
    session.commit()
    session.refresh(book)

    chapter = Chapter(book_id=book.id, ordinal=1, title="测试章节", status="approved")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title="测试场景",
        status="approved",
        content="这段正文没有违规内容，应该直接通过。",
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)

    scene_packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"test": True},
        version=1,
    )
    session.add(scene_packet)
    session.commit()
    session.refresh(scene_packet)

    book_run = _create_test_book_run(session, book)

    outcome = _judge_and_repair_loop(session, {}, book_run, scene, scene_packet)

    assert outcome["repair_rounds"] == 0, "无问题时不应触发修复"
    assert outcome["quality_score"] >= REPAIR_THRESHOLD, f"质量分应 ≥ {REPAIR_THRESHOLD}"
    assert outcome["repair_patch_ids"] == [], "无修复时 repair_patch_ids 应为空"
