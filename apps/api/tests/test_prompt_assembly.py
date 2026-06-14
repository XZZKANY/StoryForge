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
    assert state["target_word_count_min"] == 600
    assert state["target_word_count_max"] == 1600

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
    assert any(fact["statement"] == "林岚：左臂受伤未愈" and fact["must_appear"] is True for fact in facts)
    assert any(fact["source_ref"].startswith("character_bible:") for fact in facts)


def test_assemble_injects_character_bible_memory_atoms_as_continuity(session: Session) -> None:
    """Character Bible 同步出来的 memory atom 也必须进入后续章节 prompt。"""

    book_id, chapter_id = _seed_book(session)
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="character-bible-memory",
            novel_id=book_id,
            entity_type="character",
            entity_id="林岚",
            fact_type="rule",
            value='{"kind":"character_bible","canonical_name":"林岚","forbidden_traits":{"禁止":["哭泣"]}}',
            source_ref="character_bible:1:v1",
            valid_from_chapter=1,
            immutable=True,
        ),
    )

    state = assemble_prompt_injection(session, book_id=book_id, chapter_id=chapter_id)

    facts = state["continuity_facts"]
    assert facts == [
        {
            "statement": '林岚：{"kind":"character_bible","canonical_name":"林岚","forbidden_traits":{"禁止":["哭泣"]}}',
            "must_appear": True,
            "source_ref": "character_bible:1:v1",
        }
    ]


def test_assemble_injects_prior_chapter_text_as_previous_summary(session: Session) -> None:
    book_id, _ = _seed_book(session)

    state = assemble_prompt_injection(
        session,
        book_id=book_id,
        prior_chapter_text='  上一章林岚在旧港发现灯塔密钥。  ',
    )

    assert state["previous_summary_ref"] == '上一章林岚在旧港发现灯塔密钥。'


def test_assemble_omits_blank_prior_chapter_text(session: Session) -> None:
    book_id, _ = _seed_book(session)

    state = assemble_prompt_injection(session, book_id=book_id, prior_chapter_text="  ")

    assert "previous_summary_ref" not in state


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


def test_assembled_state_renders_full_chapter_prompt_via_bridge(session: Session) -> None:
    book_id, chapter_id = _seed_book(session)
    create_book_blueprint(
        session,
        BookBlueprintCreate(
            book_id=book_id,
            premise='林岚在雾港追查失真的灯塔信号。',
            tone='克制悬疑',
            target_word_count=2400,
            target_chapter_count=2,
            chapter_word_count_min=600,
            chapter_word_count_max=1600,
            metadata={},
        ),
    )

    state = assemble_prompt_injection(
        session,
        book_id=book_id,
        chapter_id=chapter_id,
        prior_chapter_text='上一章林岚在旧港发现灯塔密钥。',
    )

    prompt = build_draft_prompt_from_state(state, full_chapter=True)

    assert '写出本章完整正文（600–1600 字）' in prompt
    assert '上文衔接（保持连续，不要重复已写内容）' in prompt
    assert '上一章林岚在旧港发现灯塔密钥。' in prompt


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


def test_assemble_recap_stays_bounded_across_long_run(session: Session) -> None:
    """长跑回归：前文章节越积越多、单章越写越长时，注入的 recap 必须保持有界并收敛到预算上限，
    不随章数线性膨胀（旧 full_chapters=2 + budget=2000 让 recap 顶满 ≈12000 字符，
    既吃满 prompt 成本又把「两整章原文」当成长度范例诱导越写越长）。"""

    book = Book(title="长跑回归", status="draft", premise="收敛验证")
    session.add(book)
    session.flush()

    # 模块级 _context_cache 按 book_id 缓存，跨测试 DB 重置后 id 会复用 → 先清，保证读本测试自己的章
    from app.domains.book_runs.book_context import clear_book_context_cache

    clear_book_context_cache()

    # 造 45 章已批准长正文（每章 ~2500 字），逐章追加进 BookContext 缓存
    for ordinal in range(1, 46):
        chapter = Chapter(book_id=book.id, ordinal=ordinal, title=f"第{ordinal}章", status="approved", summary=None)
        session.add(chapter)
        session.flush()
        session.add(
            Scene(
                chapter_id=chapter.id,
                ordinal=1,
                title=f"第{ordinal}章正文",
                status="approved",
                content=f"第{ordinal}章开端。" + "线索推进。" * 500,
            )
        )
    cur = Chapter(book_id=book.id, ordinal=46, title="第46章", status="draft", summary=None)
    session.add(cur)
    session.commit()

    # 取两个「digest 早已填满预算」的晚期点位，验证 recap 已收敛到上限、不再随章数增长
    recap_30 = assemble_prompt_injection(
        session, book_id=book.id, chapter_id=cur.id, chapter_ordinal=30, chapter_title="第30章",
    )["previous_summary_ref"]
    recap_45 = assemble_prompt_injection(
        session, book_id=book.id, chapter_id=cur.id, chapter_ordinal=45, chapter_title="第45章",
    )["previous_summary_ref"]

    ceiling = 1200 * 6  # budget(1200 token) × 6 字符/token，与 estimate_tokens 的字符密度一致
    # 有界：被预算上限钳住，远低于旧 ≈12000
    assert len(recap_30) <= ceiling
    assert len(recap_45) <= ceiling
    # 收敛：饱和后第 45 章 recap 不比第 30 章长（不随章数膨胀）
    assert abs(len(recap_45) - len(recap_30)) <= 50
    # 只保留 1 章完整原文（full_chapters=1）：紧邻上一章在，更早章节降级为梗概行
    assert "【最近章节原文 · 第44章】" in recap_45
    assert "【最近章节原文 · 第43章】" not in recap_45
