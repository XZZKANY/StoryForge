"""Phase 1 Context 增量化：BookContext 缓存层单元测试。

验证目标：
1. 从 DB 初始化缓存（from_db）
2. 章节批准后追加缓存（append_chapter）
3. 编译前文上下文（compile_for_chapter）按预算裁剪
4. 风格指纹计算（compute_style_fingerprint）滚动窗口
5. 失效与清空缓存（invalidate / clear_book_context_cache）
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.book_runs.book_context import (
    BookContext,
    clear_book_context_cache,
    get_book_context,
)
from app.domains.books.models import Book, Chapter, Scene


def test_book_context_from_db_empty(session: Session) -> None:
    """无已批准章节时，from_db 返回空缓存。"""

    book = Book(title="测试作品", status="draft")
    session.add(book)
    session.commit()

    context = BookContext.from_db(session, book.id)
    assert context.book_id == book.id
    assert context.approved_chapters == []


def test_book_context_from_db_with_approved_chapters(session: Session) -> None:
    """有已批准章节时，from_db 加载全部前文语料。"""

    book = Book(title="测试作品", status="draft")
    session.add(book)
    session.commit()

    ch1 = Chapter(book_id=book.id, ordinal=1, title="第一章", summary="摘要1", status="approved")
    ch2 = Chapter(book_id=book.id, ordinal=2, title="第二章", summary="摘要2", status="approved")
    session.add_all([ch1, ch2])
    session.commit()

    sc1 = Scene(chapter_id=ch1.id, ordinal=1, title="场景1", status="approved", content="第一章正文内容")
    sc2 = Scene(chapter_id=ch2.id, ordinal=1, title="场景2", status="approved", content="第二章正文内容")
    session.add_all([sc1, sc2])
    session.commit()

    context = BookContext.from_db(session, book.id)
    assert len(context.approved_chapters) == 2
    assert context.approved_chapters[0].ordinal == 1
    assert context.approved_chapters[0].content == "第一章正文内容"
    assert context.approved_chapters[1].ordinal == 2
    assert context.approved_chapters[1].content == "第二章正文内容"


def test_book_context_append_chapter(session: Session) -> None:
    """章节批准后追加进缓存（增量更新）。"""

    book = Book(title="测试作品", status="draft")
    session.add(book)
    session.commit()

    context = BookContext(book_id=book.id)
    assert len(context.approved_chapters) == 0

    context.append_chapter(
        session=session,
        chapter_id=999,
        ordinal=1,
        title="第一章",
        summary="摘要",
        content="正文内容",
    )
    assert len(context.approved_chapters) == 1
    assert context.approved_chapters[0].ordinal == 1
    assert context.approved_chapters[0].content == "正文内容"


def test_book_context_compile_for_chapter_no_prior(session: Session) -> None:
    """当前章节无前文时，compile_for_chapter 返回 None。"""

    context = BookContext(book_id=1)
    context.approved_chapters = []

    recap = context.compile_for_chapter(ordinal=1)
    assert recap is None


def test_book_context_compile_for_chapter_with_prior(session: Session) -> None:
    """有前文时，compile_for_chapter 按分层策略（最近 N 章完整正文 + 更早章节梗概）编译。"""

    context = BookContext(book_id=1)
    context.approved_chapters = [
        type("Ch", (), {"ordinal": 1, "title": "第一章", "summary": "摘要1", "content": "第一章正文" * 100})(),
        type("Ch", (), {"ordinal": 2, "title": "第二章", "summary": "摘要2", "content": "第二章正文" * 100})(),
        type("Ch", (), {"ordinal": 3, "title": "第三章", "summary": "摘要3", "content": "第三章正文" * 100})(),
    ]

    # chapter 4 的前文：前 2 章梗概 + 第 3 章完整正文（full_chapters=1）
    recap = context.compile_for_chapter(ordinal=4, full_chapters=1, max_chars=5000)
    assert recap is not None
    assert "【前情提要（更早章节梗概）】" in recap
    assert "第一章" in recap
    assert "第二章" in recap
    assert "【最近章节原文 · 第三章】" in recap
    assert len(recap) <= 5000


def test_book_context_compile_for_chapter_truncation(session: Session) -> None:
    """超限时优先保留最近章节原文（从头截断）。"""

    context = BookContext(book_id=1)
    context.approved_chapters = [
        type("Ch", (), {"ordinal": i, "title": f"第{i}章", "summary": "", "content": "X" * 5000})()
        for i in range(1, 6)
    ]

    recap = context.compile_for_chapter(ordinal=6, full_chapters=3, max_chars=8000)
    assert recap is not None
    assert len(recap) == 8000
    # 最近章节（第 5 章）内容应该保留
    assert "第5章" in recap


def test_book_context_compute_style_fingerprint(session: Session) -> None:
    """计算风格指纹基线（基于已批准章节）。"""

    context = BookContext(book_id=1)
    context.approved_chapters = [
        type("Ch", (), {"ordinal": 1, "content": "这是第一句。这是第二句。"})(),
        type("Ch", (), {"ordinal": 2, "content": "这是第三句。这是第四句。"})(),
    ]

    fingerprint = context.compute_style_fingerprint()
    assert fingerprint is not None
    assert "average_sentence_length" in fingerprint
    assert "dialogue_ratio" in fingerprint


def test_book_context_compute_style_fingerprint_with_window(session: Session) -> None:
    """风格指纹支持滚动窗口（只取最近 N 章）。"""

    context = BookContext(book_id=1)
    context.approved_chapters = [
        type("Ch", (), {"ordinal": i, "content": f"章节{i}内容。" * 10})()
        for i in range(1, 6)
    ]

    fingerprint_all = context.compute_style_fingerprint()
    fingerprint_window = context.compute_style_fingerprint(chapter_window=2)

    assert fingerprint_all is not None
    assert fingerprint_window is not None
    # 窗口计算的句子数应该少于全量
    assert fingerprint_window["sentence_count"] < fingerprint_all["sentence_count"]


def test_book_context_invalidate(session: Session) -> None:
    """失效缓存（用户编辑已批准 scene 时触发）。"""

    context = BookContext(book_id=1)
    context.approved_chapters = [
        type("Ch", (), {"ordinal": 1, "content": "内容"})(),
    ]
    assert len(context.approved_chapters) == 1

    context.invalidate()
    assert len(context.approved_chapters) == 0
    assert context._cache_version == 0


def test_get_book_context_singleton(session: Session) -> None:
    """get_book_context 返回 book-scoped 单例缓存。"""

    book = Book(title="测试作品", status="draft")
    session.add(book)
    session.commit()

    context1 = get_book_context(session, book.id)
    context2 = get_book_context(session, book.id)
    assert context1 is context2  # 同一实例


def test_clear_book_context_cache_single_book(session: Session) -> None:
    """清空单个作品的缓存。"""

    book1 = Book(title="作品1", status="draft")
    book2 = Book(title="作品2", status="draft")
    session.add_all([book1, book2])
    session.commit()

    ctx1 = get_book_context(session, book1.id)
    ctx2 = get_book_context(session, book2.id)

    clear_book_context_cache(book1.id)

    ctx1_new = get_book_context(session, book1.id)
    ctx2_again = get_book_context(session, book2.id)

    assert ctx1 is not ctx1_new  # book1 缓存已失效
    assert ctx2 is ctx2_again    # book2 缓存未受影响


def test_clear_book_context_cache_all(session: Session) -> None:
    """清空全部缓存。"""

    book = Book(title="测试作品", status="draft")
    session.add(book)
    session.commit()

    ctx_old = get_book_context(session, book.id)
    clear_book_context_cache()  # 清空全部
    ctx_new = get_book_context(session, book.id)

    assert ctx_old is not ctx_new
