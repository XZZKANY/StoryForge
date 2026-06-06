"""Phase 1 Context 增量化：BookContext 缓存层单元测试。

验证目标：
1. 从 DB 初始化缓存（from_db）
2. 章节批准后追加缓存（append_chapter）
3. 编译前文上下文（compile_for_chapter）按预算裁剪
4. 风格指纹计算（compute_style_fingerprint）滚动窗口
5. 失效与清空缓存（invalidate / clear_book_context_cache）
"""

from __future__ import annotations

import pytest

# workflow 测试需在 workflow venv 中运行
from storyforge_workflow.prompts.book_context import (
    BookContext,
    clear_book_context_cache,
    get_book_context,
)


def test_book_context_append_chapter() -> None:
    """章节批准后追加进缓存（增量更新）。"""

    context = BookContext(book_id=1)
    assert len(context.approved_chapters) == 0

    context.append_chapter(
        session=None,  # type: ignore
        chapter_id=999,
        ordinal=1,
        title="第一章",
        summary="摘要",
        content="正文内容",
    )
    assert len(context.approved_chapters) == 1
    assert context.approved_chapters[0].ordinal == 1
    assert context.approved_chapters[0].content == "正文内容"


def test_book_context_compile_for_chapter_no_prior() -> None:
    """当前章节无前文时，compile_for_chapter 返回 None。"""

    context = BookContext(book_id=1)
    context.approved_chapters = []

    recap = context.compile_for_chapter(ordinal=1)
    assert recap is None


def test_book_context_compile_for_chapter_with_prior() -> None:
    """有前文时，compile_for_chapter 按分层策略（最近 N 章完整正文 + 更早章节梗概）编译。"""

    from storyforge_workflow.prompts.book_context import ApprovedChapter

    context = BookContext(book_id=1)
    context.approved_chapters = [
        ApprovedChapter(ordinal=1, chapter_id=1, title="第一章", summary="摘要1", content="第一章正文" * 100),
        ApprovedChapter(ordinal=2, chapter_id=2, title="第二章", summary="摘要2", content="第二章正文" * 100),
        ApprovedChapter(ordinal=3, chapter_id=3, title="第三章", summary="摘要3", content="第三章正文" * 100),
    ]

    # chapter 4 的前文：前 2 章梗概 + 第 3 章完整正文（full_chapters=1）
    recap = context.compile_for_chapter(ordinal=4, full_chapters=1, max_chars=5000)
    assert recap is not None
    assert "【前情提要（更早章节梗概）】" in recap
    assert "第一章" in recap
    assert "第二章" in recap
    assert "【最近章节原文 · 第三章】" in recap
    assert len(recap) <= 5000


def test_book_context_compile_for_chapter_truncation() -> None:
    """超限时优先保留最近章节原文（从头截断）。"""

    from storyforge_workflow.prompts.book_context import ApprovedChapter

    context = BookContext(book_id=1)
    context.approved_chapters = [
        ApprovedChapter(ordinal=i, chapter_id=i, title=f"第{i}章", summary="", content="X" * 5000)
        for i in range(1, 6)
    ]

    recap = context.compile_for_chapter(ordinal=6, full_chapters=3, max_chars=8000)
    assert recap is not None
    assert len(recap) == 8000
    # 最近章节（第 5 章）内容应该保留
    assert "第5章" in recap


def test_book_context_invalidate() -> None:
    """失效缓存（用户编辑已批准 scene 时触发）。"""

    from storyforge_workflow.prompts.book_context import ApprovedChapter

    context = BookContext(book_id=1)
    context.approved_chapters = [
        ApprovedChapter(ordinal=1, chapter_id=1, title="第一章", summary="", content="内容"),
    ]
    assert len(context.approved_chapters) == 1

    context.invalidate()
    assert len(context.approved_chapters) == 0
    assert context._cache_version == 0


def test_clear_book_context_cache_all() -> None:
    """清空全部缓存。"""

    # 模拟已有缓存
    from storyforge_workflow.prompts.book_context import _context_cache
    _context_cache[1] = BookContext(book_id=1)
    _context_cache[2] = BookContext(book_id=2)

    clear_book_context_cache()
    assert len(_context_cache) == 0


def test_clear_book_context_cache_single_book() -> None:
    """清空单个作品的缓存。"""

    from storyforge_workflow.prompts.book_context import _context_cache
    _context_cache[1] = BookContext(book_id=1)
    _context_cache[2] = BookContext(book_id=2)

    clear_book_context_cache(book_id=1)
    assert 1 not in _context_cache
    assert 2 in _context_cache
