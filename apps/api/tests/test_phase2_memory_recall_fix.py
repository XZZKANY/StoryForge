"""Phase 2 Memory 召回修复集成测试：验证 chapter 10 能召回 chapter 5 植入的 atom。

目标：修复 PK/ordinal 混淆后，召回率从 0% 升至 100%。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter
from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import create_memory_atom, get_active_memory_atoms


def test_phase2_memory_recall_chapter10_finds_chapter5_atoms(session: Session) -> None:
    """Phase 2 验证：chapter 10 能成功召回 chapter 5 植入的 memory atoms。

    修复前：PK/ordinal 混淆导致召回率 0%
    修复后：统一使用 ordinal，召回率 100%
    """

    # 创建测试作品与章节
    book = Book(title="Phase2验证作品", status="draft", premise="验证记忆召回修复")
    session.add(book)
    session.commit()

    # 创建 10 个章节
    chapters = []
    for i in range(1, 11):
        ch = Chapter(
            book_id=book.id,
            ordinal=i,
            title=f"第{i}章",
            summary=f"章节{i}摘要",
            status="approved",
        )
        session.add(ch)
        chapters.append(ch)
    session.commit()

    # 在 chapter 5 植入关键 memory atom（角色受伤）
    injury_atom = MemoryAtom(
        memory_id=f"memory:injury-{book.id}",
        novel_id=book.id,
        entity_type="character",
        entity_id="林岚",
        fact_type="status",
        value="左臂有旧伤，无法用力",
        source_ref=f"chapter:{chapters[4].id}",
        source_chapter_id=chapters[4].id,
        valid_from_chapter=5,  # 从第 5 章开始生效（ordinal）
        valid_to_chapter=None,  # 永久生效
        confidence=0.95,
        immutable=True,
    )
    create_memory_atom(session, injury_atom)

    # Phase 2 核心验证：在 chapter 10 召回，应该能找到 chapter 5 植入的 atom
    recalled_atoms = get_active_memory_atoms(
        session,
        book_id=book.id,
        chapter_ordinal=10,  # Phase 2: 传入 ordinal (10)，不是 PK
        entity_id="林岚",
    )

    # 断言：必须召回到 chapter 5 植入的伤势记忆
    assert len(recalled_atoms) == 1, (
        f"Phase 2 修复失败：chapter 10 应该召回 chapter 5 植入的 1 个 atom，"
        f"实际召回 {len(recalled_atoms)} 个。PK/ordinal 混淆未彻底修复。"
    )

    recalled = recalled_atoms[0]
    assert recalled.entity_id == "林岚"
    assert recalled.value == "左臂有旧伤，无法用力"
    assert recalled.valid_from_chapter == 5
    assert recalled.valid_to_chapter is None

    print("✅ Phase 2 Memory 召回修复验证通过：chapter 10 成功召回 chapter 5 植入的 atom")


def test_phase2_memory_recall_respects_valid_from_boundary(session: Session) -> None:
    """Phase 2 验证：召回边界正确，chapter 3 无法召回 valid_from_chapter=5 的 atom。"""

    book = Book(title="Phase2边界验证", status="draft")
    session.add(book)
    session.commit()

    chapters = []
    for i in range(1, 6):
        ch = Chapter(book_id=book.id, ordinal=i, title=f"第{i}章", status="approved")
        session.add(ch)
        chapters.append(ch)
    session.commit()

    # 植入一个从 chapter 5 开始生效的 atom
    future_atom = MemoryAtom(
        memory_id=f"memory:future-{book.id}",
        novel_id=book.id,
        entity_type="character",
        entity_id="张三",
        fact_type="status",
        value="获得线索",
        source_ref=f"chapter:{chapters[4].id}",
        valid_from_chapter=5,
        confidence=0.9,
    )
    create_memory_atom(session, future_atom)

    # chapter 3 不应召回到 valid_from_chapter=5 的 atom
    atoms_ch3 = get_active_memory_atoms(session, book_id=book.id, chapter_ordinal=3, entity_id="张三")
    assert len(atoms_ch3) == 0, "chapter 3 不应召回 valid_from_chapter=5 的 atom"

    # chapter 5 应该召回到
    atoms_ch5 = get_active_memory_atoms(session, book_id=book.id, chapter_ordinal=5, entity_id="张三")
    assert len(atoms_ch5) == 1, "chapter 5 应该召回 valid_from_chapter=5 的 atom"
    assert atoms_ch5[0].value == "获得线索"

    print("✅ Phase 2 召回边界验证通过：valid_from_chapter 正确生效")


def test_phase2_memory_recall_respects_valid_to_boundary(session: Session) -> None:
    """Phase 2 验证：召回边界正确，chapter 10 无法召回 valid_to_chapter=8 的过期 atom。"""

    book = Book(title="Phase2过期验证", status="draft")
    session.add(book)
    session.commit()

    chapters = []
    for i in range(1, 11):
        ch = Chapter(book_id=book.id, ordinal=i, title=f"第{i}章", status="approved")
        session.add(ch)
        chapters.append(ch)
    session.commit()

    # 植入一个只在 chapter 3-8 有效的 atom（伤势已痊愈）
    temp_atom = MemoryAtom(
        memory_id=f"memory:temp-{book.id}",
        novel_id=book.id,
        entity_type="character",
        entity_id="李四",
        fact_type="status",
        value="腿部骨折",
        source_ref=f"chapter:{chapters[2].id}",
        valid_from_chapter=3,
        valid_to_chapter=8,  # 只到 chapter 8
        confidence=0.9,
    )
    create_memory_atom(session, temp_atom)

    # chapter 7 应该能召回（在有效期内）
    atoms_ch7 = get_active_memory_atoms(session, book_id=book.id, chapter_ordinal=7, entity_id="李四")
    assert len(atoms_ch7) == 1, "chapter 7 应该召回 valid_to_chapter=8 的 atom"

    # chapter 10 不应召回（已过期）
    atoms_ch10 = get_active_memory_atoms(session, book_id=book.id, chapter_ordinal=10, entity_id="李四")
    assert len(atoms_ch10) == 0, "chapter 10 不应召回 valid_to_chapter=8 的过期 atom"

    print("✅ Phase 2 过期边界验证通过：valid_to_chapter 正确生效")
