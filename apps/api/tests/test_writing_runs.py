from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint

import app.models  # noqa: F401
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress
from app.domains.writing_runs.schemas import WritingRunStart
from app.domains.writing_runs.service import (
    pause_writing_run,
    resume_writing_run,
    retry_writing_run_from_checkpoint,
    start_writing_run,
)


def test_start_writing_run_full_book_managed_creates_legacy_book_run(
    session_factory: sessionmaker[Session],
) -> None:
    """Writing Run v1 应通过 full-book managed adapter 创建真实 BookRun。"""

    scope = seed_locked_blueprint(session_factory)

    with session_factory() as session:
        result = start_writing_run(
            session,
            WritingRunStart(
                scope="full_book",
                mode="managed",
                **scope,
                token_budget=1200,
                time_budget_sec=300,
                chapter_budget=2,
            ),
        )
        stored = session.get(BookRun, result.handle.book_run_id)

    assert stored is not None
    assert result.handle.scope == "full_book"
    assert result.handle.mode == "managed"
    assert result.handle.status == "running"
    assert result.handle.writing_run_id == result.handle.book_run_id == result.book_run.id
    assert result.handle.book_run.id == result.book_run.id
    assert result.handle.book_run.token_budget == 1200
    assert stored.token_budget == 1200
    assert stored.time_budget_sec == 300
    assert stored.chapter_budget == 2


def test_start_writing_run_rejects_reserved_unsupported_scope_or_mode(
    session_factory: sessionmaker[Session],
) -> None:
    """预留 scope/mode 不等于已实现能力，v1 只能启动 full_book managed。"""

    scope = seed_locked_blueprint(session_factory)

    with session_factory() as session:
        with pytest.raises(ValueError, match="scope=full_book"):
            start_writing_run(session, WritingRunStart(scope="chapter", mode="managed", **scope))
        with pytest.raises(ValueError, match="mode=managed"):
            start_writing_run(session, WritingRunStart(scope="full_book", mode="inline", **scope))


def test_writing_run_controls_drive_the_same_legacy_book_run(
    session_factory: sessionmaker[Session],
) -> None:
    """pause/resume/retry 走 Writing Run seam，但仍驱动同一个 BookRun 状态机。"""

    scope = seed_locked_blueprint(session_factory)

    with session_factory() as session:
        started = start_writing_run(session, WritingRunStart(scope="full_book", mode="managed", **scope))
        book_run_id = started.handle.book_run_id

        paused = pause_writing_run(session, book_run_id=book_run_id, reason="人工暂停")
        assert paused.handle.writing_run_id == book_run_id
        assert paused.handle.book_run_id == book_run_id
        assert paused.handle.status == "paused_by_user"
        assert paused.book_run.progress["pause_reason"] == "人工暂停"

        resumed = resume_writing_run(session, book_run_id=book_run_id)
        assert resumed.handle.writing_run_id == book_run_id
        assert resumed.handle.status == "running"
        assert resumed.book_run.progress["resume_from_chapter_index"] == 1

        apply_book_run_progress(
            session,
            book_run_id,
            BookRunProgressUpdate(
                status="paused_by_budget",
                current_chapter_index=2,
                progress={
                    "completed_chapters": [
                        {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
                        {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
                    ],
                },
            ),
        )
        retried = retry_writing_run_from_checkpoint(session, book_run_id=book_run_id)

    assert retried.handle.writing_run_id == book_run_id
    assert retried.handle.book_run_id == book_run_id
    assert retried.handle.status == "running"
    assert retried.book_run.current_chapter_index == 3
    assert retried.book_run.progress["retry_from_checkpoint"]["chapter_index"] == 2
    assert retried.book_run.progress["retry_from_chapter_index"] == 3
