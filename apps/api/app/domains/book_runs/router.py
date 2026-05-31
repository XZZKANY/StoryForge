from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.artifacts.schemas import ArtifactRead
from app.domains.book_runs.schemas import BookRunCreate, BookRunProgressUpdate, BookRunRead, BookRunWorkflowDispatch
from app.domains.book_runs.service import (
    BookRunBlockedError,
    BookRunError,
    BookRunNotFoundError,
    apply_book_run_progress,
    build_book_run_workflow_dispatch,
    create_book_run,
    get_book_run,
    resume_book_run,
)
from app.domains.exports.book_markdown_exporter import (
    BookExportError,
    export_book_run_audit_report,
    export_book_run_epub,
    export_book_run_markdown,
)

router = APIRouter(prefix="/api/book-runs", tags=["整书运行"])


@router.post("", response_model=BookRunRead, status_code=status.HTTP_201_CREATED, summary="启动 BookRun")
def create_book_run_endpoint(payload: BookRunCreate, session: SessionDependency) -> BookRunRead:
    """基于 locked Blueprint 启动整本书运行记录。"""

    try:
        return create_book_run(session, payload)
    except BookRunBlockedError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except BookRunError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{book_run_id}", response_model=BookRunRead, summary="读取 BookRun")
def get_book_run_endpoint(book_run_id: int, session: SessionDependency) -> BookRunRead:
    """读取整书运行状态、当前章节和进度摘要。"""

    try:
        return get_book_run(session, book_run_id)
    except BookRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{book_run_id}/resume", response_model=BookRunRead, summary="恢复 BookRun")
def resume_book_run_endpoint(book_run_id: int, session: SessionDependency) -> BookRunRead:
    """从最近 checkpoint 的下一章恢复整书运行。"""

    try:
        return resume_book_run(session, book_run_id)
    except BookRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BookRunBlockedError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get(
    "/{book_run_id}/workflow-dispatch",
    response_model=BookRunWorkflowDispatch,
    summary="读取 BookRun workflow 调度 payload",
)
def get_book_run_workflow_dispatch_endpoint(book_run_id: int, session: SessionDependency) -> BookRunWorkflowDispatch:
    """为外部 workflow worker 生成调度 payload；接口本身不执行 workflow。"""

    try:
        return build_book_run_workflow_dispatch(session, book_run_id)
    except BookRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BookRunBlockedError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except BookRunError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch("/{book_run_id}/progress", response_model=BookRunRead, summary="回填 BookRun 进度")
def update_book_run_progress_endpoint(
    book_run_id: int,
    payload: BookRunProgressUpdate,
    session: SessionDependency,
) -> BookRunRead:
    """接收 workflow BookLoop 回填的状态、当前章节和进度证据。"""

    try:
        return apply_book_run_progress(session, book_run_id, payload)
    except BookRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BookRunError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{book_run_id}/exports/markdown", response_model=ArtifactRead, summary="导出 BookRun Markdown")
def export_book_run_markdown_endpoint(book_run_id: int, session: SessionDependency) -> ArtifactRead:
    """为 completed BookRun 生成 book.md 制品。"""

    try:
        return export_book_run_markdown(session, book_run_id)
    except BookExportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{book_run_id}/exports/audit-report", response_model=ArtifactRead, summary="导出 BookRun 审计报告")
def export_book_run_audit_report_endpoint(book_run_id: int, session: SessionDependency) -> ArtifactRead:
    """为 completed BookRun 生成 audit_report.json 制品。"""

    try:
        return export_book_run_audit_report(session, book_run_id)
    except BookExportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{book_run_id}/exports/epub", response_model=ArtifactRead, summary="导出 BookRun EPUB")
def export_book_run_epub_endpoint(book_run_id: int, session: SessionDependency) -> ArtifactRead:
    """为 completed BookRun 生成 book.epub 制品索引。"""

    try:
        return export_book_run_epub(session, book_run_id)
    except BookExportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
