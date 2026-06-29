"""BookRun 域 Progression 生命周期。

应用进度、暂停、停止、重试、恢复等状态变更操作。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.book_runs._coerce import _non_negative_float, _non_negative_int, _string_list
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunProgressUpdate, BookRunVolumeProgress
from app.domains.book_runs.timeline import _sync_completed_chapter_timeline_events
from app.domains.provider_gateway.schemas import ProviderResolutionRead

CONTROLLED_PROGRESS_KEYS = frozenset(
    {"provider_resolution", "volume", "current_volume", "chapter_range", "volume_checkpoint"}
)

# 人工盲评门禁：本批 patch 提供则更新，未提供则保留旧值，避免后续进度回填把验收记录冲掉。
STICKY_PROGRESS_KEYS = frozenset({"manual_read_gate", "manual_read_review"})


def apply_book_run_progress(session: Session, book_run_id: int, payload: BookRunProgressUpdate) -> BookRun:
    """应用 workflow BookLoop 回填的状态、预算和 checkpoint。"""

    from app.domains.book_runs.service import BookRunError, get_book_run

    book_run = get_book_run(session, book_run_id)
    if payload.current_chapter_index > book_run.total_chapters:
        raise BookRunError("当前章节不能超过 BookRun 总章节数。")
    incoming_progress = dict(payload.progress)
    if payload.manual_read_review is not None:
        incoming_progress["manual_read_review"] = payload.manual_read_review.model_dump()
    progress = _progress_with_controlled_summaries(book_run.progress, incoming_progress, payload.volume_progress)
    book_run.status = payload.status
    book_run.current_chapter_index = payload.current_chapter_index
    book_run.progress = progress
    book_run.checkpoint = _checkpoint_from_progress(progress)
    budget = _budget_from_progress(progress)
    book_run.tokens_used = budget["tokens_used"]
    book_run.elapsed_time_sec = budget["elapsed_time_sec"]
    latency = _latency_from_progress(progress)
    book_run.total_latency_ms = latency["total_latency_ms"]
    book_run.max_latency_ms = latency["max_latency_ms"]
    book_run.avg_latency_ms = latency["avg_latency_ms"]
    book_run.estimated_cost = budget["estimated_cost"]
    book_run.cost_summary = {"estimated_cost": budget["estimated_cost"]}
    if book_run.token_budget is not None:
        book_run.cost_summary["token_budget"] = book_run.token_budget
        book_run.cost_summary["tokens_remaining"] = max(0, book_run.token_budget - book_run.tokens_used)
    budget_exceeded = _budget_exceeded(book_run, budget, payload.current_chapter_index)
    if payload.status != "completed" and budget_exceeded is not None:
        progress["pause_reason"] = budget_exceeded["reason"]
        progress["budget_exceeded"] = budget_exceeded["details"]
        book_run.status = "paused_by_budget"
        book_run.progress = progress
    _sync_completed_chapter_timeline_events(session, book_run, progress)
    session.commit()
    session.refresh(book_run)
    return book_run


def pause_book_run(session: Session, book_run_id: int, reason: str | None = None) -> BookRun:
    """暂停 BookRun，并把暂停原因写入 progress 供 IDE Run Panel 展示。"""

    from app.domains.book_runs.service import BookRunBlockedError, get_book_run

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

    from app.domains.book_runs.service import BookRunBlockedError, get_book_run

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

    from app.domains.book_runs.service import BookRunBlockedError, get_book_run

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
    progress.pop("resume_from_chapter_index", None)
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

    from app.domains.book_runs.service import BookRunBlockedError, get_book_run

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


def _checkpoint_from_progress(progress: dict) -> list[dict[str, object]]:
    checkpoints: list[dict[str, object]] = []
    for item in progress.get("completed_chapters", []):
        if not isinstance(item, dict):
            continue
        checkpoint = {
            "chapter_index": item.get("chapter_index"),
            "model_run_id": item.get("model_run_id"),
            "judge_report_id": item.get("judge_report_id"),
            "approved_scene_id": item.get("approved_scene_id"),
        }
        memory_atom_ids = _string_list(item.get("memory_atom_ids"))
        if memory_atom_ids:
            checkpoint["memory_atom_ids"] = memory_atom_ids
        checkpoints.append(checkpoint)
    return checkpoints


def _budget_from_progress(progress: dict) -> dict[str, int | float]:
    raw_budget = progress.get("budget")
    budget = raw_budget if isinstance(raw_budget, dict) else {}
    return {
        "tokens_used": _non_negative_int(budget.get("tokens_used")),
        "elapsed_time_sec": _non_negative_int(budget.get("elapsed_time_sec")),
        "estimated_cost": _non_negative_float(budget.get("estimated_cost")),
    }


def _latency_from_progress(progress: dict) -> dict[str, int]:
    completed_chapters = progress.get("completed_chapters")
    if not isinstance(completed_chapters, list):
        return {"total_latency_ms": 0, "max_latency_ms": 0, "avg_latency_ms": 0}
    latencies = [
        latency
        for item in completed_chapters
        if isinstance(item, dict)
        and (latency := _non_negative_int(item.get("generation_latency_ms"))) > 0
    ]
    if not latencies:
        return {"total_latency_ms": 0, "max_latency_ms": 0, "avg_latency_ms": 0}
    total = sum(latencies)
    return {
        "total_latency_ms": total,
        "max_latency_ms": max(latencies),
        "avg_latency_ms": round(total / len(latencies)),
    }


def _budget_exceeded(
    book_run: BookRun,
    budget: dict[str, int | float],
    current_chapter_index: int,
) -> dict[str, object] | None:
    tokens_used = int(budget["tokens_used"])
    if book_run.token_budget is not None and tokens_used >= book_run.token_budget:
        return {
            "reason": f"token 预算触顶：已使用 {tokens_used}/{book_run.token_budget} tokens。",
            "details": {"kind": "token", "used": tokens_used, "limit": book_run.token_budget},
        }

    elapsed_time_sec = int(budget["elapsed_time_sec"])
    if book_run.time_budget_sec is not None and elapsed_time_sec >= book_run.time_budget_sec:
        return {
            "reason": f"时间预算触顶：已用 {elapsed_time_sec}/{book_run.time_budget_sec} 秒。",
            "details": {"kind": "time", "used": elapsed_time_sec, "limit": book_run.time_budget_sec},
        }

    if book_run.chapter_budget is not None and current_chapter_index >= book_run.chapter_budget:
        return {
            "reason": f"章节预算触顶：已到第 {current_chapter_index}/{book_run.chapter_budget} 章。",
            "details": {"kind": "chapter", "used": current_chapter_index, "limit": book_run.chapter_budget},
        }

    return None


def _provider_resolution_progress_summary(resolution: ProviderResolutionRead) -> dict[str, object]:
    ok = resolution.credential_status not in {"missing_fallback", "reference_missing"}
    summary: dict[str, object] = {
        "ok": ok,
        "provider_name": resolution.provider_name,
        "capability": resolution.capability,
        "resolution_source": resolution.resolution_source,
        "credential_status": resolution.credential_status,
        "message": resolution.resolution_summary,
    }
    if not ok:
        summary["unavailable_reason"] = resolution.resolution_summary
    if resolution.model_aliases:
        summary["model_aliases"] = resolution.model_aliases
    return summary


def _progress_with_controlled_summaries(
    existing_progress: dict | None,
    next_progress: dict,
    volume_progress: BookRunVolumeProgress | None,
) -> dict:
    progress = {key: value for key, value in next_progress.items() if key not in CONTROLLED_PROGRESS_KEYS}
    existing = existing_progress if isinstance(existing_progress, dict) else {}
    for key in CONTROLLED_PROGRESS_KEYS:
        existing_value = existing.get(key)
        if existing_value is not None:
            progress[key] = existing_value
    for key in STICKY_PROGRESS_KEYS:
        if key in next_progress:
            continue
        existing_value = existing.get(key)
        if existing_value is not None:
            progress[key] = existing_value
    if volume_progress is not None:
        _apply_volume_progress(progress, volume_progress)
    return progress


def _apply_volume_progress(progress: dict, volume_progress: BookRunVolumeProgress) -> None:
    volume_summary = volume_progress.model_dump()
    progress["volume"] = volume_summary
    progress["current_volume"] = volume_summary["current_volume"]
    progress["chapter_range"] = volume_summary["chapter_range"]
    progress["volume_checkpoint"] = volume_summary


def _latest_checkpoint_index(checkpoint: list) -> int:
    indexes = [item.get("chapter_index") for item in checkpoint if isinstance(item, dict)]
    numeric_indexes = [value for value in indexes if isinstance(value, int)]
    return max(numeric_indexes, default=0)
