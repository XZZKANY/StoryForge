from __future__ import annotations

from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunCreate, BookRunProgressUpdate
from app.domains.books.models import Book


class BookRunError(InputError):
    """BookRun 启动输入或状态不满足整书编排约束。"""


class BookRunBlockedError(InputError):
    """BookRun 前置条件未满足。"""

    status_code = 422


class BookRunNotFoundError(NotFoundError):
    """BookRun 不存在。"""


def create_book_run(session: Session, payload: BookRunCreate) -> BookRun:
    """启动 9A 最小 BookRun，等待 workflow 顺序驱动章节。"""

    if session.get(Book, payload.book_id) is None:
        raise BookRunError("作品不存在，无法启动 BookRun。")
    blueprint = session.get(BookBlueprint, payload.blueprint_id)
    if blueprint is None or blueprint.book_id != payload.book_id:
        raise BookRunError("Blueprint 不存在或不属于目标作品。")
    if blueprint.status != "locked":
        raise BookRunBlockedError("Blueprint 尚未锁定，不能启动 BookRun。")
    book_run = BookRun(
        book_id=payload.book_id,
        blueprint_id=payload.blueprint_id,
        status="running",
        current_chapter_index=1,
        total_chapters=blueprint.target_chapter_count,
        progress={"completed_chapters": []},
        checkpoint=[],
        token_budget=payload.token_budget,
        tokens_used=0,
        time_budget_sec=payload.time_budget_sec,
        elapsed_time_sec=0,
        chapter_budget=payload.chapter_budget,
        estimated_cost=0.0,
        cost_summary={"estimated_cost": 0.0},
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)
    return book_run


def get_book_run(session: Session, book_run_id: int) -> BookRun:
    """读取 BookRun 详情。"""

    book_run = session.get(BookRun, book_run_id)
    if book_run is None:
        raise BookRunNotFoundError("BookRun 不存在。")
    return book_run


def apply_book_run_progress(session: Session, book_run_id: int, payload: BookRunProgressUpdate) -> BookRun:
    """应用 workflow BookLoop 回填的状态、预算和 checkpoint。"""

    book_run = get_book_run(session, book_run_id)
    if payload.current_chapter_index > book_run.total_chapters:
        raise BookRunError("当前章节不能超过 BookRun 总章节数。")
    book_run.status = payload.status
    book_run.current_chapter_index = payload.current_chapter_index
    book_run.progress = payload.progress
    book_run.checkpoint = _checkpoint_from_progress(payload.progress)
    budget = _budget_from_progress(payload.progress)
    book_run.tokens_used = budget["tokens_used"]
    book_run.elapsed_time_sec = budget["elapsed_time_sec"]
    book_run.estimated_cost = budget["estimated_cost"]
    book_run.cost_summary = {"estimated_cost": budget["estimated_cost"]}
    if book_run.token_budget is not None:
        book_run.cost_summary["token_budget"] = book_run.token_budget
        book_run.cost_summary["tokens_remaining"] = max(0, book_run.token_budget - book_run.tokens_used)
    session.commit()
    session.refresh(book_run)
    return book_run


def pause_book_run(session: Session, book_run_id: int, reason: str | None = None) -> BookRun:
    """暂停 BookRun，并把暂停原因写入 progress 供 IDE Run Panel 展示。"""

    book_run = get_book_run(session, book_run_id)
    if book_run.status == "completed":
        raise BookRunBlockedError("已完成的 BookRun 不能暂停。")
    if book_run.status == "stopped":
        raise BookRunBlockedError("已停止的 BookRun 不能暂停。")
    progress = dict(book_run.progress or {})
    progress["pause_reason"] = reason or "用户暂停"
    progress["paused_at_chapter_index"] = book_run.current_chapter_index
    book_run.status = "paused_by_user"
    book_run.progress = progress
    session.commit()
    session.refresh(book_run)
    return book_run


def stop_book_run(session: Session, book_run_id: int, reason: str | None = None) -> BookRun:
    """停止 BookRun，并记录用户停止原因。"""

    book_run = get_book_run(session, book_run_id)
    if book_run.status == "completed":
        raise BookRunBlockedError("已完成的 BookRun 不能停止。")
    progress = dict(book_run.progress or {})
    progress["stop_reason"] = reason or "用户停止"
    progress["stopped_at_chapter_index"] = book_run.current_chapter_index
    book_run.status = "stopped"
    book_run.progress = progress
    session.commit()
    session.refresh(book_run)
    return book_run


def retry_book_run_from_checkpoint(session: Session, book_run_id: int) -> BookRun:
    """从最近 checkpoint 重试 BookRun。"""

    book_run = get_book_run(session, book_run_id)
    if book_run.status == "completed":
        raise BookRunBlockedError("已完成的 BookRun 不能从 checkpoint 重试。")
    checkpoint = list(book_run.checkpoint or [])
    latest_index = _latest_checkpoint_index(checkpoint)
    if latest_index == 0:
        raise BookRunBlockedError("BookRun 没有 checkpoint，无法重试。")
    next_index = min(book_run.total_chapters, latest_index + 1)
    latest_checkpoint = next(
        (item for item in reversed(checkpoint) if isinstance(item, dict) and item.get("chapter_index") == latest_index),
        None,
    )
    progress = dict(book_run.progress or {})
    progress["retry_from_checkpoint"] = latest_checkpoint or {"chapter_index": latest_index}
    progress["retry_from_chapter_index"] = next_index
    book_run.status = "running"
    book_run.current_chapter_index = next_index
    book_run.progress = progress
    session.commit()
    session.refresh(book_run)
    return book_run


def resume_book_run(session: Session, book_run_id: int) -> BookRun:
    """从最近 checkpoint 的下一章恢复 BookRun。"""

    book_run = get_book_run(session, book_run_id)
    if book_run.status == "completed":
        raise BookRunBlockedError("已完成的 BookRun 不能 resume。")
    completed_chapters = list(book_run.progress.get("completed_chapters", []))
    latest_index = _latest_checkpoint_index(book_run.checkpoint or completed_chapters)
    next_index = min(book_run.total_chapters, latest_index + 1) if latest_index else book_run.current_chapter_index
    progress = dict(book_run.progress or {})
    progress["completed_chapters"] = completed_chapters
    progress["resume_from_chapter_index"] = next_index
    book_run.status = "running"
    book_run.current_chapter_index = next_index
    book_run.progress = progress
    session.commit()
    session.refresh(book_run)
    return book_run


def _checkpoint_from_progress(progress: dict) -> list[dict[str, int | None]]:
    checkpoints: list[dict[str, int | None]] = []
    for item in progress.get("completed_chapters", []):
        if not isinstance(item, dict):
            continue
        checkpoints.append(
            {
                "chapter_index": item.get("chapter_index"),
                "model_run_id": item.get("model_run_id"),
                "judge_report_id": item.get("judge_report_id"),
                "approved_scene_id": item.get("approved_scene_id"),
            }
        )
    return checkpoints


def _budget_from_progress(progress: dict) -> dict[str, int | float]:
    raw_budget = progress.get("budget")
    budget = raw_budget if isinstance(raw_budget, dict) else {}
    return {
        "tokens_used": _non_negative_int(budget.get("tokens_used")),
        "elapsed_time_sec": _non_negative_int(budget.get("elapsed_time_sec")),
        "estimated_cost": _non_negative_float(budget.get("estimated_cost")),
    }


def _latest_checkpoint_index(checkpoint: list) -> int:
    indexes = [item.get("chapter_index") for item in checkpoint if isinstance(item, dict)]
    numeric_indexes = [value for value in indexes if isinstance(value, int)]
    return max(numeric_indexes, default=0)


def _non_negative_int(value: object) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def _non_negative_float(value: object) -> float:
    return float(value) if isinstance(value, int | float) and value > 0 else 0.0
