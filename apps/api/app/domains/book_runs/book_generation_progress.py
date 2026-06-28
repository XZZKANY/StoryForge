from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress


def _pause_by_failure(
    session: Session,
    book_run_id: int,
    chapter_index: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
    error_message: str,
) -> None:
    """单章生成失败时落库已完成证据，便于断点诊断与续跑，而非整进程零证据退出。"""

    session.rollback()
    apply_book_run_progress(
        session,
        book_run_id,
        BookRunProgressUpdate(
            status="failed",
            current_chapter_index=chapter_index,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {"tokens_used": tokens_used, "elapsed_time_sec": 0, "estimated_cost": 0.0},
                "failure": {"chapter_index": chapter_index, "error": error_message[:2000]},
            },
        ),
    )


def _pause_by_interrupt(
    session: Session,
    book_run_id: int,
    chapter_index: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
) -> None:
    """进程被中断（Ctrl-C / SystemExit）时把 run 落为可续跑的 paused，避免孤儿 running。"""

    session.rollback()
    apply_book_run_progress(
        session,
        book_run_id,
        BookRunProgressUpdate(
            status="paused_by_user",
            current_chapter_index=chapter_index,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {"tokens_used": tokens_used, "elapsed_time_sec": 0, "estimated_cost": 0.0},
                "pause_reason": f"在第 {chapter_index} 章生成期间被中断，已保住前 {len(completed_chapters)} 章证据。",
            },
        ),
    )


def _pause_by_budget(
    session: Session,
    book_run_id: int,
    chapter_index: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
) -> None:
    apply_book_run_progress(
        session,
        book_run_id,
        BookRunProgressUpdate(
            status="paused_by_budget",
            current_chapter_index=chapter_index,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {"tokens_used": tokens_used, "elapsed_time_sec": 0, "estimated_cost": 0.0},
                "pause_reason": "token_budget_exceeded",
            },
        ),
    )
