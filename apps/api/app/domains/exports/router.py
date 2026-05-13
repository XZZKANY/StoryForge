from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.exports.service import ExportNotFoundError, build_epub_export, build_markdown_export

router = APIRouter(prefix="/api/books/{book_id}/exports", tags=["作品导出"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/markdown")
def export_book_markdown(book_id: int, session: SessionDependency) -> Response:
    """导出作品已批准章节正文为 Markdown。"""

    try:
        content = build_markdown_export(session, book_id)
    except ExportNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="book-{book_id}.md"'},
    )


@router.get("/epub")
def export_book_epub(book_id: int, session: SessionDependency) -> Response:
    """导出作品已批准章节正文为最小 EPUB。"""

    try:
        content = build_epub_export(session, book_id)
    except ExportNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="application/epub+zip",
        headers={"Content-Disposition": f'attachment; filename="book-{book_id}.epub"'},
    )
