from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.blueprints.schemas import BookBlueprintCreate
from app.domains.blueprints.service import create_book_blueprint
from app.domains.book_runs.prompt_assembly import assemble_prompt_injection
from app.domains.book_runs.workflow_prompt_bridge import build_draft_prompt_from_state
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.schemas import CharacterBibleCreate
from app.domains.character_bible.service import create_character_bible_entry
from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import create_memory_atom
from app.domains.style_packs.schemas import StylePackCreate
from app.domains.style_packs.service import create_style_pack


def _seed_book(session: Session) -> tuple[int, int]:
    book = Book(title="雾港装配", status="draft", premise="原始 premise")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="第一章 雾港", status="draft", summary=None)
    session.add(chapter)
    session.commit()
    return book.id, chapter.id


def test_assemble_reads_all_consistency_sources(session: Session) -> None:
    book_id, chapter_id = _seed_book(session)
    create_book_blueprint(
        session,
        BookBlueprintCreate(
            book_id=book_id,
            premise="林岚在雾港追查失真的灯塔信号。",
            tone="克制悬疑",
            target_word_count=2400,
            target_chapter_count=2,
            chapter_word_count_min=600,
            chapter_word_count_max=1600,
            metadata={"title_seed": "灯塔余烬"},
        ),
    )
    create_character_bible_entry(
        session,
        CharacterBibleCreate(
            book_id=book_id,
            canonical_name="林岚",
            aliases=["雾港调查员"],
            voice_traits={"语气": "克制", "句式": ["短句", "少解释"]},
            forbidden_traits={"禁止": ["突然健谈"], "替换": {"突然健谈": "短促回答"}},
        ),
    )
    create_style_pack(
        session,
        StylePackCreate(
            book_id=book_id,
            name="雾港风格",
            payload={
                "语气": "克制悬疑",
                "视角": "第三人称贴身",
                "规则": ["多用动作与画面"],
                "禁用表达": ["不禁", "情不自禁"],
                "示例句": ["她把左臂藏进披风，没有解释。"],
            },
        ),
    )
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="m1",
            novel_id=book_id,
            entity_type="character",
            entity_id="林岚",
            fact_type="status",
            value="左臂受伤未愈",
            source_ref="第一章",
            valid_from_chapter=1,
            immutable=True,
        ),
    )

    state = assemble_prompt_injection(
        session,
        book_id=book_id,
        chapter_id=chapter_id,
        chapter_title="第一章 雾港",
        chapter_goal="建立调查线索。",
    )

    assert state["premise"] == "林岚在雾港追查失真的灯塔信号。"
    assert state["strategy_tone_ref"] == "克制悬疑"
    assert state["strategy_title_ref"] == "灯塔余烬"
    assert state["chapter_title_ref"] == "第一章 雾港"
    assert state["chapter_goal_ref"] == "建立调查线索。"

    character = state["character_constraints"][0]
    assert character["name"] == "林岚"
    assert character["aliases"] == ["雾港调查员"]
    assert "克制" in character["voice_traits"]
    # 替换映射不应混入禁止短语
    assert character["forbidden_traits"] == ["突然健谈"]

    style = state["style_directive"]
    assert style["tone"] == "克制悬疑"
    assert style["pov"] == "第三人称贴身"
    assert style["rules"] == ["多用动作与画面"]
    assert style["forbidden_phrases"] == ["不禁", "情不自禁"]

    facts = state["continuity_facts"]
    assert facts[0]["statement"] == "林岚：左臂受伤未愈"
    assert facts[0]["must_appear"] is True


def test_assemble_omits_missing_sources(session: Session) -> None:
    book_id, _ = _seed_book(session)
    state = assemble_prompt_injection(session, book_id=book_id)
    assert "character_constraints" not in state
    assert "style_directive" not in state
    assert "continuity_facts" not in state
    assert "premise" not in state


def _seed_approved_chapter(session: Session, book_id: int) -> None:
    """补一章已批准正文，作为风格指纹前馈基线来源。"""

    approved = Chapter(book_id=book_id, ordinal=2, title="第二章 旧港", status="approved", summary=None)
    session.add(approved)
    session.flush()
    scene = Scene(
        chapter_id=approved.id,
        ordinal=1,
        title="谈判",
        status="approved",
        content="林岚把左臂藏进披风。她没有解释。灯塔信号第七分钟再次回响，她压下不安，只把维修窗口推上谈判桌。",
    )
    session.add(scene)
    session.commit()


def test_assemble_injects_style_fingerprint_when_approved_chapter_exists(session: Session) -> None:
    book_id, chapter_id = _seed_book(session)
    _seed_approved_chapter(session, book_id)

    state = assemble_prompt_injection(
        session,
        book_id=book_id,
        chapter_id=chapter_id,
        chapter_title="第一章 雾港",
        chapter_goal="建立调查线索。",
    )

    fingerprint = state["style_directive"]["fingerprint"]
    assert fingerprint["average_sentence_length"] > 0
    assert "dialogue_ratio" in fingerprint
    assert "restraint_density" in fingerprint


def test_assemble_skips_fingerprint_without_approved_chapter(session: Session) -> None:
    book_id, chapter_id = _seed_book(session)
    create_style_pack(
        session,
        StylePackCreate(book_id=book_id, name="雾港风格", payload={"语气": "克制悬疑"}),
    )

    state = assemble_prompt_injection(session, book_id=book_id, chapter_id=chapter_id)

    assert "fingerprint" not in state["style_directive"]


def test_assembled_state_renders_layered_prompt_via_bridge(session: Session) -> None:
    book_id, chapter_id = _seed_book(session)
    create_character_bible_entry(
        session,
        CharacterBibleCreate(
            book_id=book_id,
            canonical_name="林岚",
            voice_traits={"语气": "克制"},
            forbidden_traits={"禁止": ["突然健谈"]},
        ),
    )
    create_style_pack(
        session,
        StylePackCreate(
            book_id=book_id,
            name="雾港风格",
            payload={"禁用表达": ["不禁"], "规则": ["多用动作"]},
        ),
    )
    state = assemble_prompt_injection(
        session,
        book_id=book_id,
        chapter_id=chapter_id,
        chapter_title="第一章 雾港",
        chapter_goal="建立调查线索。",
    )
    prompt = build_draft_prompt_from_state(state)
    assert "林岚" in prompt
    assert "禁止表现：突然健谈" in prompt
    assert "禁用表达（绝不能出现）：不禁" in prompt
    assert "当前章节：第一章 雾港" in prompt
