"""Book-scoped 上下文缓存层：消除每章全量重建前文语料的 O(N²) 问题。

Phase 1 Context 增量化核心组件：
- 前文语料一次查询、章间共享、按预算裁剪
- 风格指纹滚动窗口计算
- 生命周期：BookRun 启动时构造 → 每章批准后追加 → 完成时序列化

设计原则：
- 增量编译：chapter N 批准后追加进缓存，chapter N+1 直接复用
- 事件溯源：真相源是 approved Scene，缓存是派生视图
- 预算感知：compile_for_chapter 按 max_chars 裁剪输出
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Chapter, Scene


@dataclass
class ApprovedChapter:
    """已批准章节的缓存快照。"""

    ordinal: int
    chapter_id: int
    title: str
    summary: str
    content: str  # 首个 approved scene 的 content


@dataclass
class BookContext:
    """Book-scoped 单例缓存，持有已批准前文语料与风格指纹。

    生命周期：
    - BookRun 启动时构造（传入 book_id + session）
    - 每章批准后调用 append_chapter
    - 完成时可选 serialize 进 Artifact
    """

    book_id: int
    approved_chapters: list[ApprovedChapter] = field(default_factory=list)
    _cache_version: int = 0  # Scene.updated_at 的 max，用于失效检测

    def append_chapter(
        self,
        session: Session,
        chapter_id: int,
        ordinal: int,
        title: str,
        summary: str,
        content: str,
    ) -> None:
        """章节批准后追加进缓存（增量更新）。"""

        self.approved_chapters.append(
            ApprovedChapter(
                ordinal=ordinal,
                chapter_id=chapter_id,
                title=title,
                summary=summary,
                content=content,
            )
        )
        self._cache_version += 1

    def compile_for_chapter(
        self,
        ordinal: int,
        *,
        full_chapters: int = 2,
        max_chars: int = 12000,
    ) -> str | None:
        """编译章节 N 的前文上下文（按预算裁剪）。

        Args:
            ordinal: 当前章节序号（前文是 < ordinal 的已批准章节）
            full_chapters: 最近 N 章给完整正文，更早章节压成前情提要
            max_chars: 总长度上限（超限时从头截断，优先保留最近章节）

        Returns:
            前文 recap 字符串，无前文时返回 None
        """

        prior = [ch for ch in self.approved_chapters if ch.ordinal < ordinal]
        if not prior:
            return None

        # 分层：最近 full_chapters 章完整正文 + 更早章节梗概
        full = prior[-full_chapters:] if full_chapters > 0 else []
        older = prior[: len(prior) - len(full)]

        sections: list[str] = []
        if older:
            digest_lines = [
                f"- {ch.title}：{(ch.summary or ch.content)[:200]}" for ch in older
            ]
            sections.append("【前情提要（更早章节梗概）】\n" + "\n".join(digest_lines))

        for ch in full:
            sections.append(f"【最近章节原文 · {ch.title}】\n{ch.content}")

        recap = "\n\n".join(sections)
        if len(recap) <= max_chars:
            return recap

        # 超限时优先保留最近章节原文（位于末尾），从头截断
        return recap[-max_chars:]

    def compute_style_fingerprint(
        self,
        *,
        chapter_window: int | None = None,
    ) -> dict[str, float | int] | None:
        """计算风格指纹基线（基于已批准章节）。

        Args:
            chapter_window: 只取最近 N 个已批准章节，None 则全部

        Returns:
            StyleFingerprint.as_payload() 格式的 dict，无章节时返回 None
        """

        if not self.approved_chapters:
            return None

        contents = [ch.content for ch in self.approved_chapters]
        if chapter_window is not None and chapter_window > 0:
            contents = contents[-chapter_window:]

        if not contents:
            return None

        # 调用 judge.service._style_fingerprint 计算
        # 这里需要避免循环导入，所以延迟 import
        from app.domains.judge.service import _style_fingerprint

        return _style_fingerprint("\n".join(contents)).as_payload()

    def invalidate(self) -> None:
        """强制失效缓存（用户编辑已批准 scene 时触发）。"""

        self.approved_chapters.clear()
        self._cache_version = 0

    def serialize(self) -> dict[str, Any]:
        """序列化为 Artifact（BookRun 完成时保存快照）。"""

        return {
            "book_id": self.book_id,
            "approved_chapters": [
                {
                    "ordinal": ch.ordinal,
                    "chapter_id": ch.chapter_id,
                    "title": ch.title,
                    "summary": ch.summary,
                    "content_preview": ch.content[:500],  # 仅保留预览，不存全文
                }
                for ch in self.approved_chapters
            ],
            "cache_version": self._cache_version,
        }

    @classmethod
    def from_db(
        cls,
        session: Session,
        book_id: int,
        *,
        up_to_ordinal: int | None = None,
    ) -> BookContext:
        """从 DB 初始化缓存（BookRun 启动时调用一次）。

        Args:
            session: SQLAlchemy session
            book_id: 作品 ID
            up_to_ordinal: 只加载 <= 此序号的章节，None 则加载全部已批准章节

        Returns:
            已填充 approved_chapters 的 BookContext 实例
        """

        context = cls(book_id=book_id)

        query = (
            select(Chapter.ordinal, Chapter.id, Chapter.title, Chapter.summary, Scene.content)
            .join(Scene, Scene.chapter_id == Chapter.id)
            .where(
                Chapter.book_id == book_id,
                Chapter.status == "approved",
                Scene.status == "approved",
                Scene.content.is_not(None),
            )
            .order_by(Chapter.ordinal, Scene.ordinal, Scene.id)
        )

        if up_to_ordinal is not None:
            query = query.where(Chapter.ordinal <= up_to_ordinal)

        rows = session.execute(query).all()

        # 同章多个已批准 scene 时只取序最靠前的一个
        seen: set[int] = set()
        for ordinal, chapter_id, title, summary, content in rows:
            if ordinal in seen:
                continue
            body = str(content).strip() if content else ""
            if not body:
                continue
            seen.add(ordinal)
            context.approved_chapters.append(
                ApprovedChapter(
                    ordinal=ordinal,
                    chapter_id=chapter_id,
                    title=str(title or f"第{ordinal}章"),
                    summary=str(summary or "").strip(),
                    content=body,
                )
            )

        return context


# Module-level 缓存：key 是 book_id，避免单 BookRun 内多次查询
_context_cache: dict[int, BookContext] = {}


def get_book_context(session: Session, book_id: int) -> BookContext:
    """获取或创建 book-scoped 缓存单例。

    首次访问时从 DB 加载，后续访问直接返回缓存实例。
    """

    if book_id not in _context_cache:
        _context_cache[book_id] = BookContext.from_db(session, book_id)
    return _context_cache[book_id]


def clear_book_context_cache(book_id: int | None = None) -> None:
    """清空缓存（测试或用户编辑已批准 scene 时调用）。

    Args:
        book_id: 指定作品 ID 则只清除该作品，None 则清除全部
    """

    if book_id is None:
        _context_cache.clear()
    else:
        _context_cache.pop(book_id, None)
