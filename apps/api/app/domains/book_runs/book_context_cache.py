"""BookContext process cache and SQLAlchemy invalidation listeners."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.domains.book_runs.book_context_core import BookContext, BookContextCacheObserver
from app.domains.books.models import Chapter, Scene

_context_cache: dict[int, BookContext] = {}
_context_cache_lock = threading.Lock()
_context_cache_observer_lock = threading.Lock()
_context_cache_observer: BookContextCacheObserver | None = None


def _active_cache_observer() -> BookContextCacheObserver | None:
    with _context_cache_observer_lock:
        return _context_cache_observer


@contextmanager
def observe_book_context_cache() -> Iterator[BookContextCacheObserver]:
    """在当前进程临时启用 BookContext 命中率观测，覆盖并发章节线程。"""

    global _context_cache_observer
    observer = BookContextCacheObserver()
    with _context_cache_observer_lock:
        previous = _context_cache_observer
        _context_cache_observer = observer
    try:
        yield observer
    finally:
        with _context_cache_observer_lock:
            _context_cache_observer = previous


def get_book_context(session: Session, book_id: int) -> BookContext:
    """获取或创建 book-scoped 缓存单例。"""

    with _context_cache_lock:
        hit = book_id in _context_cache
        observer = _active_cache_observer()
        if observer is not None:
            observer.record(hit=hit)
        if not hit:
            _context_cache[book_id] = BookContext.from_db(session, book_id)
        return _context_cache[book_id]


def clear_book_context_cache(book_id: int | None = None) -> None:
    """清空全部缓存，或只清除指定作品的缓存。"""

    if book_id is None:
        with _context_cache_lock:
            _context_cache.clear()
    else:
        with _context_cache_lock:
            _context_cache.pop(book_id, None)


_BOOK_CONTEXT_INVALIDATION_KEY = "book_context_invalidate_book_ids"
_BOOK_CONTEXT_SKIP_INVALIDATION_KEY = "book_context_skip_invalidate_book_ids"


def skip_book_context_invalidation_once(session: Session, book_id: int) -> None:
    """当前事务将自行维护 BookContext 时，跳过提交后的兜底清理。"""

    book_ids = session.info.setdefault(_BOOK_CONTEXT_SKIP_INVALIDATION_KEY, set())
    book_ids.add(book_id)


@event.listens_for(Session, "after_flush")
def _collect_book_context_invalidations(session: Session, _flush_context: object) -> None:
    """收集会影响已批准前文快照的直接 ORM 写入，提交后统一清缓存。"""

    book_ids = session.info.setdefault(_BOOK_CONTEXT_INVALIDATION_KEY, set())
    for obj in list(session.dirty):
        if isinstance(obj, Chapter) and _chapter_affects_book_context(obj, deleted=False):
            book_ids.add(obj.book_id)
        elif isinstance(obj, Scene) and _scene_affects_book_context(obj, deleted=False):
            book_id = _book_id_for_scene(session, obj)
            if book_id is not None:
                book_ids.add(book_id)
    for obj in list(session.deleted):
        if isinstance(obj, Chapter) and _chapter_affects_book_context(obj, deleted=True):
            book_ids.add(obj.book_id)
        elif isinstance(obj, Scene) and _scene_affects_book_context(obj, deleted=True):
            book_id = _book_id_for_scene(session, obj)
            if book_id is not None:
                book_ids.add(book_id)


@event.listens_for(Session, "after_commit")
def _clear_book_context_after_commit(session: Session) -> None:
    """事务成功后再清缓存，避免失败回滚路径误删可用快照。"""

    book_ids = session.info.pop(_BOOK_CONTEXT_INVALIDATION_KEY, set())
    skip_book_ids = session.info.pop(_BOOK_CONTEXT_SKIP_INVALIDATION_KEY, set())
    for book_id in book_ids:
        if book_id in skip_book_ids:
            continue
        clear_book_context_cache(int(book_id))


@event.listens_for(Session, "after_rollback")
def _discard_book_context_invalidations(session: Session) -> None:
    """事务回滚时丢弃待清理标记。"""

    session.info.pop(_BOOK_CONTEXT_INVALIDATION_KEY, None)
    session.info.pop(_BOOK_CONTEXT_SKIP_INVALIDATION_KEY, None)


def _chapter_affects_book_context(chapter: Chapter, *, deleted: bool) -> bool:
    state = inspect(chapter)
    if deleted:
        return chapter.status == "approved"
    status_history = state.attrs.status.history
    if status_history.has_changes():
        statuses = [value for value in (*status_history.deleted, *status_history.added) if value is not None]
        return "approved" in statuses
    if chapter.status == "approved":
        return any(state.attrs[name].history.has_changes() for name in ("summary", "title"))
    return False


def _scene_affects_book_context(scene: Scene, *, deleted: bool) -> bool:
    state = inspect(scene)
    if deleted:
        return scene.status == "approved"
    status_history = state.attrs.status.history
    if status_history.has_changes():
        statuses = [value for value in (*status_history.deleted, *status_history.added) if value is not None]
        return "approved" in statuses
    if scene.status == "approved":
        return any(state.attrs[name].history.has_changes() for name in ("content", "chapter_id", "ordinal", "title"))
    return False


def _book_id_for_scene(session: Session, scene: Scene) -> int | None:
    if scene.chapter is not None:
        return scene.chapter.book_id
    chapter_id = scene.chapter_id
    if chapter_id is None:
        return None
    chapter = session.get(Chapter, chapter_id)
    return chapter.book_id if chapter is not None else None
