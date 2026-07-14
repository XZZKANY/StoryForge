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

import threading
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Chapter, Scene


@dataclass(frozen=True)
class BookContextCacheSnapshot:
    """BookContext 缓存观测快照，用于真实 runner 产出可审计指标。"""

    hits: int
    misses: int

    @property
    def total(self) -> int:
        return self.hits + self.misses

    @property
    def hit_rate(self) -> float | None:
        if self.total == 0:
            return None
        return round(self.hits / self.total, 3)


class BookContextCacheObserver:
    """线程安全记录 BookContext 缓存命中情况。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def record(self, *, hit: bool) -> None:
        with self._lock:
            if hit:
                self._hits += 1
            else:
                self._misses += 1

    def snapshot(self) -> BookContextCacheSnapshot:
        with self._lock:
            return BookContextCacheSnapshot(hits=self._hits, misses=self._misses)


@dataclass
class ApprovedChapter:
    """已批准章节的缓存快照。"""

    ordinal: int
    chapter_id: int
    title: str
    summary: str
    content: str  # 同章 approved scenes 按序拼接后的章节正文


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
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

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

        with self._lock:
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

        with self._lock:
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

    def compile_blocks_for_chapter(
        self,
        ordinal: int,
        *,
        chapter_id: int | None = None,
        full_chapters: int = 2,
        token_budget: int = 2000,
    ) -> str | None:
        """预算感知编译章节 N 的前文上下文，取代 compile_for_chapter 的裸字符截断。

        用 context_compiler.compile_context 做有序裁剪：最近章原文标 required 保连续，
        更早章节梗概按预算从低优先丢弃，而非无差别从头截断。required 单块即超预算时
        （极长章）回退 compile_for_chapter，保证热路径不崩。
        """

        # 延迟 import：避免与 context_compiler 的潜在循环，沿用本类 compute_style_fingerprint 先例
        from pydantic import ValidationError

        from app.domains.context_compiler.schemas import ContextBlock, ContextCompileRequest
        from app.domains.context_compiler.service import compile_context
        from app.domains.scene_packets.budget import estimate_tokens

        with self._lock:
            prior = [ch for ch in self.approved_chapters if ch.ordinal < ordinal]
        if not prior:
            return None

        full = prior[-full_chapters:] if full_chapters > 0 else []
        older = prior[: len(prior) - len(full)]

        blocks: list[ContextBlock] = []
        for ch in older:
            digest = f"{ch.title}：{(ch.summary or ch.content)[:200]}".strip()
            if not digest:
                continue
            blocks.append(
                ContextBlock(
                    block_id=f"older-{ch.ordinal}",
                    kind="memory_atom",
                    title=str(ch.title or f"第{ch.ordinal}章")[:200],
                    content=digest[:100000],
                    source_ref=f"chapter:{ch.ordinal}:digest",
                    token_count=estimate_tokens(digest),
                    priority="low",
                    injection_position="memory",
                    score=float(ch.ordinal),
                )
            )

        last_ordinal = full[-1].ordinal if full else None
        for ch in full:
            body = (ch.content or "").strip()
            if not body:
                continue
            blocks.append(
                ContextBlock(
                    block_id=f"full-{ch.ordinal}",
                    kind="scene_goal",
                    title=str(ch.title or f"第{ch.ordinal}章")[:200],
                    content=body[:100000],
                    source_ref=f"chapter:{ch.ordinal}:content",
                    token_count=estimate_tokens(body),
                    priority="required" if ch.ordinal == last_ordinal else "high",
                    injection_position="scene",
                    score=float(ch.ordinal),
                )
            )

        if not blocks:
            return self.compile_for_chapter(ordinal, full_chapters=full_chapters, max_chars=token_budget * 6)

        try:
            compiled = compile_context(
                ContextCompileRequest(
                    novel_id=self.book_id,
                    chapter_id=chapter_id or 1,  # 仅用于算 context_id 与回填，不影响裁剪
                    scene_id=chapter_id or 1,  # 章级 recap 无当前 scene，借 chapter_id 占位
                    token_budget=token_budget,
                    blocks=blocks,
                    score_threshold=0.0,
                )
            )
        except (ValidationError, ValueError):
            # required（最近章原文）单块即超预算 → 回退裸截断，热路径不崩
            return self.compile_for_chapter(ordinal, full_chapters=full_chapters, max_chars=token_budget * 6)

        ordered = sorted(compiled.injected_blocks, key=lambda block: block.order)
        sections: list[str] = []
        digest_lines = [f"- {block.content}" for block in ordered if block.injection_position == "memory"]
        if digest_lines:
            sections.append("【前情提要（更早章节梗概）】\n" + "\n".join(digest_lines))
        for block in ordered:
            if block.injection_position == "scene":
                sections.append(f"【最近章节原文 · {block.title}】\n{block.content}")
        recap = "\n\n".join(sections)
        return recap or None

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

        with self._lock:
            contents = [ch.content for ch in self.approved_chapters]
        if chapter_window is not None and chapter_window > 0:
            contents = contents[-chapter_window:]

        if not contents:
            return None

        # 调用 judge.service.style_fingerprint 计算
        # 这里需要避免循环导入，所以延迟 import
        from app.domains.judge.service import style_fingerprint

        return style_fingerprint("\n".join(contents)).as_payload()

    def invalidate(self) -> None:
        """强制失效缓存（用户编辑已批准 scene 时触发）。"""

        with self._lock:
            self.approved_chapters.clear()
            self._cache_version = 0

    def serialize(self) -> dict[str, Any]:
        """序列化为 Artifact（BookRun 完成时保存快照）。"""

        with self._lock:
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

        chapters: dict[int, ApprovedChapter] = {}
        scene_bodies: dict[int, list[str]] = {}
        for ordinal, chapter_id, title, summary, content in rows:
            body = str(content).strip() if content else ""
            if not body:
                continue
            if ordinal not in chapters:
                chapters[ordinal] = ApprovedChapter(
                    ordinal=ordinal,
                    chapter_id=chapter_id,
                    title=str(title or f"第{ordinal}章"),
                    summary=str(summary or "").strip(),
                    content="",
                )
                scene_bodies[ordinal] = []
            scene_bodies[ordinal].append(body)

        for ordinal in sorted(chapters):
            chapter = chapters[ordinal]
            context.approved_chapters.append(
                ApprovedChapter(
                    ordinal=chapter.ordinal,
                    chapter_id=chapter.chapter_id,
                    title=chapter.title,
                    summary=chapter.summary,
                    content="\n\n".join(scene_bodies[ordinal]),
                )
            )

        return context
