"""统一的游标分页工具。

设计原则：
- 基于主键 `id` 的游标（不是 offset），避免大表深分页性能塌方。
- 调用方传入 `Select` 语句，helper 内部追加 `WHERE id > :cursor` 和 `LIMIT :limit + 1`。
- 仅当 caller 显式提供 limit 时切换为分页响应；保持既有 list 端点向后兼容。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Generic, TypeVar

from sqlalchemy import Select
from sqlalchemy.orm import Session

DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100

T = TypeVar("T")


@dataclass(frozen=True)
class CursorPage(Generic[T]):
    """统一的分页响应快照。"""

    items: list[T]
    next_cursor: str | None
    has_more: bool


def parse_cursor(cursor: str | None) -> int | None:
    """游标编码为整数主键的字符串形式；空值或非法值视为无游标。"""

    if cursor is None or not cursor.strip():
        return None
    try:
        value = int(cursor)
    except ValueError:
        return None
    return value if value > 0 else None


def clamp_limit(limit: int | None) -> int:
    """限制 limit 范围，避免客户端请求过大的页大小。"""

    if limit is None or limit <= 0:
        return DEFAULT_PAGE_LIMIT
    return min(limit, MAX_PAGE_LIMIT)


def paginate_by_id(
    session: Session,
    statement: Select,
    *,
    id_column,
    cursor: str | None,
    limit: int | None,
) -> CursorPage:
    """执行游标分页查询，要求 statement 已显式按 id_column 升序排序。

    使用 `LIMIT limit + 1` 的窥探技巧判定 has_more，避免额外的 count 查询。
    """

    page_size = clamp_limit(limit)
    cursor_id = parse_cursor(cursor)
    paginated_statement = statement
    if cursor_id is not None:
        paginated_statement = paginated_statement.where(id_column > cursor_id)
    paginated_statement = paginated_statement.limit(page_size + 1)
    rows = list(session.scalars(paginated_statement).all())
    has_more = len(rows) > page_size
    items = rows[:page_size]
    next_cursor = str(items[-1].id) if has_more and items else None
    return CursorPage(items=items, next_cursor=next_cursor, has_more=has_more)


def envelope_from_items(
    items: Sequence[T],
    *,
    limit: int | None,
    next_cursor: str | None = None,
    has_more: bool = False,
) -> dict[str, object]:
    """将已经载入的 items 包成统一信封；用于无法走 SQL 分页的小集合接口。"""

    return {
        "items": list(items),
        "next_cursor": next_cursor,
        "has_more": has_more,
    }
