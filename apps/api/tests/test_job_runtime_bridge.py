from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.domains.books.models import Book
from app.domains.jobs.models import JobRun
from app.domains.jobs.service import sync_job_run_with_runtime

import pytest


@pytest.fixture()
def session() -> Generator[Session, None, None]:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    with factory() as db_session:
        yield db_session
    Base.metadata.drop_all(engine)
    engine.dispose()


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
