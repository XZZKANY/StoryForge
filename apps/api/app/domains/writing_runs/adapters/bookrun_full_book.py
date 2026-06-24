from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunRead
from app.domains.book_runs.service import (
    create_book_run,
    pause_book_run,
    resume_book_run,
    retry_book_run_from_checkpoint,
    stop_book_run,
)
from app.domains.writing_runs.schemas import WritingRunHandle, WritingRunStart


@dataclass(frozen=True)
class BookRunWritingRunResult:
    """Canonical Writing Run handle plus the legacy BookRun object."""

    handle: WritingRunHandle
    book_run: BookRun


def start_full_book_writing_run(session: Session, payload: WritingRunStart) -> BookRunWritingRunResult:
    _assert_full_book_managed(payload)
    return _result(create_book_run(session, payload.to_book_run_create()))


def pause_full_book_writing_run(
    session: Session,
    book_run_id: int,
    reason: str | None = None,
) -> BookRunWritingRunResult:
    return _result(pause_book_run(session, book_run_id, reason))


def resume_full_book_writing_run(session: Session, book_run_id: int) -> BookRunWritingRunResult:
    return _result(resume_book_run(session, book_run_id))


def stop_full_book_writing_run(
    session: Session,
    book_run_id: int,
    reason: str | None = None,
) -> BookRunWritingRunResult:
    return _result(stop_book_run(session, book_run_id, reason))


def retry_full_book_writing_run_from_checkpoint(session: Session, book_run_id: int) -> BookRunWritingRunResult:
    return _result(retry_book_run_from_checkpoint(session, book_run_id))


def _result(book_run: BookRun) -> BookRunWritingRunResult:
    handle = WritingRunHandle(
        writing_run_id=book_run.id,
        scope="full_book",
        mode="managed",
        status=book_run.status,
        book_run_id=book_run.id,
        book_run=BookRunRead.model_validate(book_run),
    )
    return BookRunWritingRunResult(handle=handle, book_run=book_run)


def _assert_full_book_managed(payload: WritingRunStart) -> None:
    if payload.scope != "full_book" or payload.mode != "managed":
        raise ValueError("Writing Run v1 仅支持 scope=full_book 且 mode=managed。")
