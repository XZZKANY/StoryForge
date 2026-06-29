from __future__ import annotations

import json

from app.domains.book_runs.models import BookRun
from app.domains.ide.schemas import IdeRunEvent
from app.domains.writing_runs.service import full_book_writing_run_event_data


def build_run_events(book_run: BookRun) -> list[IdeRunEvent]:
    """从 BookRun 聚合状态投影 IDE Run Panel 事件列表。"""

    progress = book_run.progress or {}
    completed = [item for item in progress.get("completed_chapters", []) if isinstance(item, dict)]
    writing_run = full_book_writing_run_event_data(book_run.id, book_run.status)
    events = [
        IdeRunEvent(
            event="progress",
            data={
                **writing_run,
                "current_chapter_index": book_run.current_chapter_index,
                "total_chapters": book_run.total_chapters,
                "completed_count": len(completed),
            },
        )
    ]
    if book_run.checkpoint:
        events.append(
            IdeRunEvent(
                event="checkpoint",
                data={
                    **writing_run,
                    "latest_checkpoint": book_run.checkpoint[-1],
                    "checkpoint": book_run.checkpoint,
                },
            )
        )
    blocked_chapter = progress.get("blocked_chapter")
    if isinstance(blocked_chapter, dict):
        events.append(IdeRunEvent(event="blocked", data={**writing_run, "blocked_chapter": blocked_chapter}))
    events.append(
        IdeRunEvent(
            event="budget",
            data={
                **writing_run,
                "token_budget": book_run.token_budget,
                "tokens_used": book_run.tokens_used,
                "tokens_remaining": _tokens_remaining(book_run),
                "elapsed_time_sec": book_run.elapsed_time_sec,
                "time_budget_sec": book_run.time_budget_sec,
                "estimated_cost": book_run.estimated_cost,
            },
        )
    )
    provider_fallback = progress.get("provider_fallback")
    if isinstance(provider_fallback, dict):
        events.append(IdeRunEvent(event="provider_fallback", data={**writing_run, "provider_fallback": provider_fallback}))
    if book_run.status == "completed":
        events.append(IdeRunEvent(event="completed", data={**writing_run, "completed_count": len(completed)}))
    return events


def encode_sse_event(event: str, data: dict[str, object]) -> str:
    """编码单条 SSE 事件文本。"""

    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _tokens_remaining(book_run: BookRun) -> int | None:
    if book_run.token_budget is None:
        return None
    return max(0, book_run.token_budget - book_run.tokens_used)
