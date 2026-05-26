from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.jobs.models import JobRun
from app.domains.jobs.service import sync_job_run_with_runtime


def test_sync_job_run_with_runtime_updates_progress(session: Session) -> None:
    book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
    session.add(book)
    session.flush()
    job = JobRun(book_id=book.id, job_type="generation_runtime", status="queued", progress={})
    session.add(job)
    session.commit()

    updated = sync_job_run_with_runtime(
        session,
        job_run_id=job.id,
        thread_id="phase4-thread",
        current_node="draft_writer",
        status="running",
        approval_status="pending",
        provider_execution={"provider_name": "mock-provider", "model_name": "storyforge-writer"},
    )

    assert updated.status == "running"
    assert updated.progress["thread_id"] == "phase4-thread"
    assert updated.progress["current_node"] == "draft_writer"
    assert updated.progress["approval_status"] == "pending"
    assert updated.progress["provider_execution"]["provider_name"] == "mock-provider"
