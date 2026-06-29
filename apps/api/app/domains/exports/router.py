from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.db.deps import SessionDependency
from app.domains.exports.service import build_epub_export, build_markdown_export

router = APIRouter(prefix="/api/books/{book_id}/exports", tags=["作品导出"])


@router.get(
    "/markdown",
    summary="导出作品 Markdown",
)
def export_book_markdown(
    book_id: int,
    workspace_id: Annotated[int, Query(gt=0)],
    session: SessionDependency,
) -> Response:
    """导出作品已批准章节正文为 Markdown。"""

    content = build_markdown_export(session, book_id, workspace_id=workspace_id)
    return Response(
        content=content,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="book-{book_id}.md"'},
    )


@router.get(
    "/epub",
    summary="导出作品 EPUB",
)
def export_book_epub(
    book_id: int,
    workspace_id: Annotated[int, Query(gt=0)],
    session: SessionDependency,
) -> Response:
    """导出作品已批准章节正文为最小 EPUB。"""

    content = build_epub_export(session, book_id, workspace_id=workspace_id)
    return Response(
        content=content,
        media_type="application/epub+zip",
        headers={"Content-Disposition": f'attachment; filename="book-{book_id}.epub"'},
    )
