from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.writing_runs.adapters.bookrun_full_book import (
    BookRunWritingRunResult,
    pause_full_book_writing_run,
    resume_full_book_writing_run,
    retry_full_book_writing_run_from_checkpoint,
    start_full_book_writing_run,
    stop_full_book_writing_run,
)
from app.domains.writing_runs.schemas import WritingRunStart


def writing_run_payload(result: BookRunWritingRunResult) -> dict[str, object]:
    """Canonical Writing Run payload with legacy BookRun compatibility fields."""

    writing_run = result.handle.model_dump(mode="json")
    book_run = result.handle.book_run.model_dump(mode="json")
    return {
        "writing_run": writing_run,
        "writing_run_id": writing_run["writing_run_id"],
        "scope": writing_run["scope"],
        "mode": writing_run["mode"],
        "status": writing_run["status"],
        "book_run": book_run,
        "book_run_id": writing_run["book_run_id"],
    }


def full_book_writing_run_event_data(book_run_id: int, status: str) -> dict[str, object]:
    """Canonical event fields for the BookRun-backed full-book managed adapter."""

    return {
        "writing_run_id": book_run_id,
        "scope": "full_book",
        "mode": "managed",
        "status": status,
        "book_run_id": book_run_id,
    }


def start_writing_run(session: Session, payload: WritingRunStart) -> BookRunWritingRunResult:
    """Start a Writing Run through the matching implementation adapter."""

    if payload.scope == "full_book" and payload.mode == "managed":
        return start_full_book_writing_run(session, payload)
    raise ValueError("Writing Run v1 仅支持 scope=full_book 且 mode=managed。")


def pause_writing_run(
    session: Session,
    *,
    book_run_id: int,
    reason: str | None = None,
) -> BookRunWritingRunResult:
    return pause_full_book_writing_run(session, book_run_id, reason)


def resume_writing_run(session: Session, *, book_run_id: int) -> BookRunWritingRunResult:
    return resume_full_book_writing_run(session, book_run_id)


def stop_writing_run(
    session: Session,
    *,
    book_run_id: int,
    reason: str | None = None,
) -> BookRunWritingRunResult:
    return stop_full_book_writing_run(session, book_run_id, reason)


def retry_writing_run_from_checkpoint(session: Session, *, book_run_id: int) -> BookRunWritingRunResult:
    return retry_full_book_writing_run_from_checkpoint(session, book_run_id)
