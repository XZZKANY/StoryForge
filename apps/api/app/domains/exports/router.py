from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.db.deps import SessionDependency
from app.domains.exports.service import (
    ExportForbiddenError,
    ExportNotFoundError,
    build_epub_export,
    build_markdown_export,
)

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

    try:
        content = build_markdown_export(session, book_id, workspace_id=workspace_id)
    except ExportForbiddenError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ExportNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
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

    try:
        content = build_epub_export(session, book_id, workspace_id=workspace_id)
    except ExportForbiddenError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ExportNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="application/epub+zip",
        headers={"Content-Disposition": f'attachment; filename="book-{book_id}.epub"'},
    )
