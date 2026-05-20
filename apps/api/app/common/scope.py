from __future__ import annotations

from sqlalchemy.orm import Session

from app.common.exceptions import NotFoundError
from app.domains.books.models import Book
from app.domains.workspaces.models import Workspace


class ScopeNotFoundError(NotFoundError):
    """作用域对象不存在。"""


def validate_scope(
    session: Session,
    workspace_id: int | None,
    book_id: int | None,
    *,
    error_prefix: str = "",
) -> None:
    """校验工作区和作品作用域是否存在。"""

    if workspace_id is not None and session.get(Workspace, workspace_id) is None:
        raise ScopeNotFoundError(f"{error_prefix}工作区不存在。")
    if book_id is not None and session.get(Book, book_id) is None:
        raise ScopeNotFoundError(f"{error_prefix}作品不存在。")
