from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.jobs.models import JobRun
from app.domains.model_runs.service import get_runs_job_run


def test_runs_job_run_read_side_uses_persisted_runtime_progress(session: Session) -> None:
    """Runs 读侧应从持久化 JobRun.progress 派生 checkpoint 和 runtime diagnostics。"""

    book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
    session.add(book)
    session.flush()
    job = JobRun(
        book_id=book.id,
        job_type="generation_runtime",
        status="running",
        progress={
            "thread_id": "phase4-thread",
            "current_node": "draft_writer",
            "approval_status": "pending",
            "provider_execution": {"provider_name": "mock-provider", "model_name": "storyforge-writer"},
        },
    )
    session.add(job)
    session.commit()

    result = get_runs_job_run(session, job_run_id=job.id)

    assert result["status"] == "running"
    assert result["checkpoint"] == {
        "thread_id": "phase4-thread",
        "current_node": "draft_writer",
        "approval_status": "pending",
    }
    assert result["runtime_diagnostics"]["workflow_session"]["thread_id"] == "phase4-thread"
    assert result["runtime_diagnostics"]["workflow_session"]["current_node"] == "draft_writer"
    assert result["runtime_diagnostics"]["workflow_session"]["approval_status"] == "pending"
    assert result["runtime_diagnostics"]["provider"]["provider_name"] == "mock-provider"
