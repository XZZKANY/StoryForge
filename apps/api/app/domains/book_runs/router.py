from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Query, status

from app.db.deps import SessionDependency
from app.domains.agent_runs.service import record_book_run_snapshot
from app.domains.artifacts.schemas import ArtifactRead
from app.domains.book_runs.schemas import (
    BookRunControlRequest,
    BookRunCreate,
    BookRunProgressUpdate,
    BookRunRead,
    BookRunStartRequest,
    BookRunWorkflowDispatch,
)
from app.domains.book_runs.service import (
    apply_book_run_progress,
    assert_book_run_startable,
    build_book_run_workflow_dispatch,
    create_book_run,
    get_book_run,
    mark_book_run_generation_dispatched,
    pause_book_run,
    resume_book_run,
    retry_book_run_from_checkpoint,
    run_book_run_generation_blocking,
    stop_book_run,
)
from app.domains.exports.book_markdown_exporter import (
    export_book_run_audit_report,
    export_book_run_epub,
    export_book_run_markdown,
)

router = APIRouter(prefix="/api/book-runs", tags=["整书运行"])


@router.post("", response_model=BookRunRead, status_code=status.HTTP_201_CREATED, summary="启动 BookRun")
def create_book_run_endpoint(payload: BookRunCreate, session: SessionDependency) -> BookRunRead:
    """基于 locked Blueprint 启动整本书运行记录。"""

    book_run = create_book_run(session, payload)
    record_book_run_snapshot(session, book_run=book_run, source="bookrun.create")
    return book_run


@router.get("/{book_run_id}", response_model=BookRunRead, summary="读取 BookRun")
def get_book_run_endpoint(book_run_id: int, session: SessionDependency) -> BookRunRead:
    """读取整书运行状态、当前章节和进度摘要。"""

    return get_book_run(session, book_run_id)


@router.post(
    "/{book_run_id}/start",
    response_model=BookRunRead,
    status_code=status.HTTP_202_ACCEPTED,
    summary="发起 BookRun 后台生成",
)
def start_book_run_endpoint(
    book_run_id: int,
    payload: BookRunStartRequest,
    session: SessionDependency,
    background_tasks: BackgroundTasks,
) -> BookRunRead:
    """对已创建的 running BookRun 发起后台生成（封顶 6 章，复用 Phase 9B 串行编排）。

    会消耗真实 LLM 预算；缺少 STORYFORGE_LLM_* 凭据时立即返回 422。
    """

    env = dict(os.environ)
    _, chapter_count, token_budget = assert_book_run_startable(
        session,
        book_run_id,
        max_chapters=payload.max_chapters,
        token_budget=payload.token_budget,
        env=env,
    )

    book_run = mark_book_run_generation_dispatched(session, book_run_id)
    record_book_run_snapshot(session, book_run=book_run, source="bookrun.start")
    background_tasks.add_task(
        run_book_run_generation_blocking,
        book_run_id,
        chapter_count=chapter_count,
        token_budget=token_budget,
        env=env,
    )
    return book_run


@router.post("/{book_run_id}/resume", response_model=BookRunRead, summary="恢复 BookRun")
def resume_book_run_endpoint(book_run_id: int, session: SessionDependency) -> BookRunRead:
    """从最近 checkpoint 的下一章恢复整书运行。"""

    book_run = resume_book_run(session, book_run_id)
    record_book_run_snapshot(session, book_run=book_run, source="bookrun.resume")
    return book_run


@router.post("/{book_run_id}/pause", response_model=BookRunRead, summary="暂停 BookRun")
def pause_book_run_endpoint(
    book_run_id: int,
    payload: BookRunControlRequest,
    session: SessionDependency,
) -> BookRunRead:
    """暂停整书运行，并记录暂停原因供 Assistant 工具树展示。"""

    book_run = pause_book_run(session, book_run_id, payload.reason)
    record_book_run_snapshot(session, book_run=book_run, source="bookrun.pause")
    return book_run


@router.post("/{book_run_id}/stop", response_model=BookRunRead, summary="停止 BookRun")
def stop_book_run_endpoint(
    book_run_id: int,
    payload: BookRunControlRequest,
    session: SessionDependency,
) -> BookRunRead:
    """停止整书运行，并记录用户停止原因。"""

    book_run = stop_book_run(session, book_run_id, payload.reason)
    record_book_run_snapshot(session, book_run=book_run, source="bookrun.stop")
    return book_run


@router.post("/{book_run_id}/retry", response_model=BookRunRead, summary="从 checkpoint 重试 BookRun")
def retry_book_run_endpoint(book_run_id: int, session: SessionDependency) -> BookRunRead:
    """从最近 checkpoint 的下一章重试整书运行。"""

    book_run = retry_book_run_from_checkpoint(session, book_run_id)
    record_book_run_snapshot(session, book_run=book_run, source="bookrun.retry_from_checkpoint")
    return book_run


@router.get(
    "/{book_run_id}/workflow-dispatch",
    response_model=BookRunWorkflowDispatch,
    summary="读取 BookRun workflow 调度 payload",
)
def get_book_run_workflow_dispatch_endpoint(book_run_id: int, session: SessionDependency) -> BookRunWorkflowDispatch:
    """为外部 workflow worker 生成调度 payload；接口本身不执行 workflow。"""

    return build_book_run_workflow_dispatch(session, book_run_id)


@router.patch("/{book_run_id}/progress", response_model=BookRunRead, summary="回填 BookRun 进度")
def update_book_run_progress_endpoint(
    book_run_id: int,
    payload: BookRunProgressUpdate,
    session: SessionDependency,
) -> BookRunRead:
    """接收 workflow BookLoop 回填的状态、当前章节和进度证据。"""

    book_run = apply_book_run_progress(session, book_run_id, payload)
    record_book_run_snapshot(session, book_run=book_run, source="bookrun.progress")
    return book_run


@router.post("/{book_run_id}/exports/markdown", response_model=ArtifactRead, summary="导出 BookRun Markdown")
def export_book_run_markdown_endpoint(
    book_run_id: int,
    workspace_id: Annotated[int, Query(gt=0)],
    session: SessionDependency,
) -> ArtifactRead:
    """为 completed BookRun 生成 book.md 制品。"""

    return export_book_run_markdown(session, book_run_id, workspace_id=workspace_id)


@router.post("/{book_run_id}/exports/audit-report", response_model=ArtifactRead, summary="导出 BookRun 审计报告")
def export_book_run_audit_report_endpoint(
    book_run_id: int,
    workspace_id: Annotated[int, Query(gt=0)],
    session: SessionDependency,
) -> ArtifactRead:
    """为 completed BookRun 生成 audit_report.json 制品。"""

    return export_book_run_audit_report(session, book_run_id, workspace_id=workspace_id)


@router.post("/{book_run_id}/exports/epub", response_model=ArtifactRead, summary="导出 BookRun EPUB")
def export_book_run_epub_endpoint(
    book_run_id: int,
    workspace_id: Annotated[int, Query(gt=0)],
    session: SessionDependency,
) -> ArtifactRead:
    """为 completed BookRun 生成 book.epub 制品索引。"""

    return export_book_run_epub(session, book_run_id, workspace_id=workspace_id)
