from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import (
    BookRunChapterRange,
    BookRunCreate,
    BookRunProgressUpdate,
    BookRunVolumePlanItem,
    BookRunVolumeProgress,
    BookRunWorkflowChapter,
    BookRunWorkflowDispatch,
    BookRunWorkflowPlanningRefs,
)
from app.domains.books.models import Book, Chapter
from app.domains.character_bible.service import list_character_bible_entries
from app.domains.provider_gateway.schemas import ProviderResolutionRead
from app.domains.provider_gateway.service import resolve_provider
from app.domains.story_memory.service import list_memory_atoms
from app.domains.timeline.models import TimelineEventRecord
from app.domains.timeline.schemas import TimelineEventCreate
from app.domains.timeline.service import list_timeline_events

CONTROLLED_PROGRESS_KEYS = frozenset(
    {"provider_resolution", "volume", "current_volume", "chapter_range", "volume_checkpoint"}
)
DEFAULT_TIMELINE_PROJECT_ID = 1
DEFAULT_TIMELINE_VOLUME_ID = 1


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
        progress={
            "completed_chapters": [],
            "provider_resolution": _provider_resolution_progress_summary(resolve_provider(session, "llm")),
        },
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


def build_book_run_workflow_dispatch(session: Session, book_run_id: int) -> BookRunWorkflowDispatch:
    """生成 workflow worker 可消费的 BookRun 调度 payload，但不执行 workflow。"""

    book_run = get_book_run(session, book_run_id)
    if book_run.status != "running":
        raise BookRunBlockedError("只有 running BookRun 可以生成 workflow dispatch。")
    blueprint = session.get(BookBlueprint, book_run.blueprint_id)
    if blueprint is None:
        raise BookRunBlockedError("BookRun 关联的 Blueprint 不存在。")
    chapters = session.scalars(
        select(Chapter)
        .where(Chapter.book_id == book_run.book_id, Chapter.blueprint_id == book_run.blueprint_id)
        .order_by(Chapter.ordinal)
    ).all()
    chapters_by_index = {chapter.ordinal: chapter for chapter in chapters}
    start_chapter_index = _dispatch_start_chapter_index(book_run)
    required_indexes = range(start_chapter_index, book_run.total_chapters + 1)
    missing = [index for index in required_indexes if index not in chapters_by_index]
    if missing:
        raise BookRunBlockedError("BookRun 缺少章节计划，无法生成 workflow dispatch。")
    volume_plan = _volume_plan_from_blueprint(blueprint, book_run.total_chapters)
    _require_longform_context_ready(session, book_run=book_run, blueprint=blueprint, volume_plan=volume_plan)
    return BookRunWorkflowDispatch(
        book_run_id=book_run.id,
        book_id=book_run.book_id,
        blueprint_id=book_run.blueprint_id,
        total_chapters=book_run.total_chapters,
        start_chapter_index=start_chapter_index,
        existing_checkpoint=list(book_run.checkpoint or []),
        token_budget=book_run.token_budget,
        time_budget_sec=book_run.time_budget_sec,
        chapter_budget=book_run.chapter_budget,
        provider_fallback_pause_threshold=None,
        chapters=[
            BookRunWorkflowChapter(
                chapter_index=index,
                chapter_id=chapters_by_index[index].id,
                chapter_goal=_chapter_goal(chapters_by_index[index]),
                planning_refs=_chapter_planning_refs(blueprint, index),
            )
            for index in required_indexes
        ],
        volume_plan=volume_plan,
    )


def apply_book_run_progress(session: Session, book_run_id: int, payload: BookRunProgressUpdate) -> BookRun:
    """应用 workflow BookLoop 回填的状态、预算和 checkpoint。"""

    book_run = get_book_run(session, book_run_id)
    if payload.current_chapter_index > book_run.total_chapters:
        raise BookRunError("当前章节不能超过 BookRun 总章节数。")
    progress = _progress_with_controlled_summaries(book_run.progress, payload.progress, payload.volume_progress)
    book_run.status = payload.status
    book_run.current_chapter_index = payload.current_chapter_index
    book_run.progress = progress
    book_run.checkpoint = _checkpoint_from_progress(progress)
    budget = _budget_from_progress(progress)
    book_run.tokens_used = budget["tokens_used"]
    book_run.elapsed_time_sec = budget["elapsed_time_sec"]
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


def _sync_completed_chapter_timeline_events(session: Session, book_run: BookRun, progress: dict) -> None:
    completed_chapters = progress.get("completed_chapters")
    if not isinstance(completed_chapters, list):
        return
    completed_items = [item for item in completed_chapters if isinstance(item, dict)]
    if not completed_items:
        return
    chapters_by_progress = _chapters_by_completed_progress(session, book_run, completed_items)
    chapter_ids = [chapter.id for chapter in chapters_by_progress.values()]
    existing_events = _existing_timeline_events_by_chapter(session, book_run.id, book_run.book_id, chapter_ids)
    for completed_chapter in completed_items:
        chapter = chapters_by_progress.get(_completed_progress_key(completed_chapter))
        if chapter is None:
            continue
        if _timeline_event_matches_completed_chapter(
            existing_events.get(chapter.id, []),
            book_run.id,
            chapter.id,
            completed_chapter,
        ):
            continue
        payload = _timeline_event_payload_for_completed_chapter(book_run, progress, completed_chapter, chapter)
        session.add(TimelineEventRecord(**payload.model_dump()))


def _chapters_by_completed_progress(
    session: Session,
    book_run: BookRun,
    completed_chapters: list[dict],
) -> dict[tuple[str, int], Chapter]:
    chapter_ids = {
        chapter_id
        for completed_chapter in completed_chapters
        if (chapter_id := _positive_int(completed_chapter.get("chapter_id"))) is not None
    }
    chapter_indexes = {
        chapter_index
        for completed_chapter in completed_chapters
        if _positive_int(completed_chapter.get("chapter_id")) is None
        and (chapter_index := _positive_int(completed_chapter.get("chapter_index"))) is not None
    }
    chapters: list[Chapter] = []
    if chapter_ids:
        chapters.extend(
            session.scalars(
                select(Chapter).where(
                    Chapter.book_id == book_run.book_id,
                    Chapter.id.in_(chapter_ids),
                )
            ).all()
        )
    if chapter_indexes:
        chapters.extend(
            session.scalars(
                select(Chapter).where(
                    Chapter.book_id == book_run.book_id,
                    Chapter.ordinal.in_(chapter_indexes),
                )
            ).all()
        )
    by_id = {chapter.id: chapter for chapter in chapters}
    by_index = {chapter.ordinal: chapter for chapter in chapters}
    resolved: dict[tuple[str, int], Chapter] = {}
    for completed_chapter in completed_chapters:
        key = _completed_progress_key(completed_chapter)
        chapter = by_id.get(key[1]) if key[0] == "chapter_id" else by_index.get(key[1])
        if chapter is not None:
            resolved[key] = chapter
    return resolved


def _completed_progress_key(completed_chapter: dict) -> tuple[str, int]:
    chapter_id = _positive_int(completed_chapter.get("chapter_id"))
    if chapter_id is not None:
        return ("chapter_id", chapter_id)
    chapter_index = _positive_int(completed_chapter.get("chapter_index"))
    return ("chapter_index", chapter_index or 0)


def _existing_timeline_events_by_chapter(
    session: Session,
    book_run_id: int,
    book_id: int,
    chapter_ids: list[int],
) -> dict[int, list[TimelineEventRecord]]:
    if not chapter_ids:
        return {}
    source_ref = f"book_run:{book_run_id}"
    rows = session.scalars(
        select(TimelineEventRecord).where(
            TimelineEventRecord.book_id == book_id,
            TimelineEventRecord.chapter_id.in_(chapter_ids),
        )
    ).all()
    grouped: dict[int, list[TimelineEventRecord]] = {}
    for event in rows:
        evidence_refs = event.evidence_refs if isinstance(event.evidence_refs, list) else []
        payload = event.payload if isinstance(event.payload, dict) else {}
        if source_ref not in evidence_refs and payload.get("source") != source_ref:
            continue
        grouped.setdefault(event.chapter_id, []).append(event)
    return grouped


def _timeline_event_matches_completed_chapter(
    candidates: list[TimelineEventRecord],
    book_run_id: int,
    chapter_id: int,
    completed_chapter: dict,
) -> bool:
    for event in candidates:
        if _timeline_event_is_completed_chapter_match(event, book_run_id, chapter_id, completed_chapter):
            return True
    return False


def _timeline_event_is_completed_chapter_match(
    event: TimelineEventRecord,
    book_run_id: int,
    chapter_id: int,
    completed_chapter: dict,
) -> bool:
    source_ref = f"book_run:{book_run_id}"
    chapter_ref = f"chapter:{chapter_id}"
    chapter_index = completed_chapter.get("chapter_index")
    evidence_refs = event.evidence_refs if isinstance(event.evidence_refs, list) else []
    payload = event.payload if isinstance(event.payload, dict) else {}
    completed_payload = payload.get("completed_chapter")
    if source_ref in evidence_refs and chapter_ref in evidence_refs:
        return True
    if payload.get("source") != source_ref or not isinstance(completed_payload, dict):
        return False
    return completed_payload.get("chapter_index") == chapter_index

def _timeline_event_payload_for_completed_chapter(
    book_run: BookRun,
    progress: dict,
    completed_chapter: dict,
    chapter: Chapter,
) -> TimelineEventCreate:
    defaulted_fields: dict[str, str] = {}
    project_id = _timeline_project_id(progress, completed_chapter, defaulted_fields)
    volume_id = _timeline_volume_id(progress, completed_chapter, defaulted_fields)
    chapter_index = _positive_int(completed_chapter.get("chapter_index")) or chapter.ordinal
    payload = {
        "source": f"book_run:{book_run.id}",
        "book_run_id": book_run.id,
        "completed_chapter": _timeline_completed_chapter_payload(completed_chapter, chapter),
    }
    if defaulted_fields:
        payload["defaulted_fields"] = defaulted_fields
    return TimelineEventCreate(
        project_id=project_id,
        book_id=book_run.book_id,
        volume_id=volume_id,
        chapter_id=chapter.id,
        time_order=chapter_index,
        summary=_timeline_summary_for_completed_chapter(completed_chapter, chapter),
        evidence_refs=_timeline_evidence_refs(book_run.id, chapter.id, completed_chapter),
        payload=payload,
    )


def _timeline_completed_chapter_payload(completed_chapter: dict, chapter: Chapter) -> dict[str, object]:
    payload = {
        key: value
        for key, value in completed_chapter.items()
        if key
        in {
            "chapter_index",
            "chapter_id",
            "model_run_id",
            "judge_report_id",
            "approved_scene_id",
            "summary",
            "chapter_summary",
            "final_summary",
            "volume_id",
            "project_id",
        }
    }
    payload["chapter_id"] = chapter.id
    payload.setdefault("chapter_index", chapter.ordinal)
    return payload


def _timeline_project_id(progress: dict, completed_chapter: dict, defaulted_fields: dict[str, str]) -> int:
    project_id = _positive_int(completed_chapter.get("project_id")) or _positive_int(progress.get("project_id"))
    if project_id is not None:
        return project_id
    defaulted_fields["project_id"] = "BookRun progress 未提供 project_id，当前作品模型没有项目字段，使用受控默认 1。"
    return DEFAULT_TIMELINE_PROJECT_ID


def _timeline_volume_id(progress: dict, completed_chapter: dict, defaulted_fields: dict[str, str]) -> int:
    volume_id = (
        _positive_int(completed_chapter.get("volume_id"))
        or _positive_int(progress.get("volume_id"))
        or _positive_int(progress.get("current_volume"))
        or _positive_int(_nested_progress_int(progress, "volume", "current_volume"))
        or _positive_int(_nested_progress_int(progress, "volume_checkpoint", "current_volume"))
    )
    if volume_id is not None:
        return volume_id
    defaulted_fields["volume_id"] = "BookRun progress 未提供 volume_id，当前章节模型没有卷字段，使用受控默认 1。"
    return DEFAULT_TIMELINE_VOLUME_ID


def _nested_progress_int(progress: dict, key: str, nested_key: str) -> object:
    value = progress.get(key)
    return value.get(nested_key) if isinstance(value, dict) else None


def _timeline_summary_for_completed_chapter(completed_chapter: dict, chapter: Chapter) -> str:
    for key in ("summary", "chapter_summary", "final_summary"):
        value = completed_chapter.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return (chapter.summary or chapter.title or f"第 {chapter.ordinal} 章已完成").strip()


def _timeline_evidence_refs(book_run_id: int, chapter_id: int, completed_chapter: dict) -> list[str]:
    refs = [f"book_run:{book_run_id}", f"chapter:{chapter_id}"]
    for key, prefix in (
        ("model_run_id", "model_run"),
        ("judge_report_id", "judge_report"),
        ("approved_scene_id", "approved_scene"),
    ):
        value = _positive_int(completed_chapter.get(key))
        if value is not None:
            refs.append(f"{prefix}:{value}")
    refs.extend(f"memory:{memory_id}" for memory_id in _string_list(completed_chapter.get("memory_atom_ids")))
    return refs


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _budget_from_progress(progress: dict) -> dict[str, int | float]:
    raw_budget = progress.get("budget")
    budget = raw_budget if isinstance(raw_budget, dict) else {}
    return {
        "tokens_used": _non_negative_int(budget.get("tokens_used")),
        "elapsed_time_sec": _non_negative_int(budget.get("elapsed_time_sec")),
        "estimated_cost": _non_negative_float(budget.get("estimated_cost")),
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


def _positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and value > 0 else None


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


def _non_negative_int(value: object) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def _non_negative_float(value: object) -> float:
    return float(value) if isinstance(value, int | float) and value > 0 else 0.0

def _dispatch_start_chapter_index(book_run: BookRun) -> int:
    progress = book_run.progress if isinstance(book_run.progress, dict) else {}
    retry_index = progress.get("retry_from_chapter_index")
    if isinstance(retry_index, int) and retry_index >= 1:
        return retry_index
    resume_index = progress.get("resume_from_chapter_index")
    if isinstance(resume_index, int) and resume_index >= 1:
        return resume_index
    return max(1, book_run.current_chapter_index)


def _chapter_goal(chapter: Chapter) -> str:
    return (chapter.summary or chapter.title or f"第 {chapter.ordinal} 章").strip()


def _chapter_planning_refs(blueprint: BookBlueprint, chapter_index: int) -> BookRunWorkflowPlanningRefs | None:
    metadata = blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {}
    summary = metadata.get("planning_summary")
    if not isinstance(summary, dict):
        return None
    chapter_arc_links = summary.get("chapter_arc_links")
    if not isinstance(chapter_arc_links, dict):
        return None
    arc_ids = chapter_arc_links.get(str(chapter_index))
    if not isinstance(arc_ids, list):
        return None
    valid_arc_ids = [arc_id for arc_id in arc_ids if isinstance(arc_id, str) and arc_id.strip()]
    if not valid_arc_ids:
        return None
    ratio = summary.get("arc_completion_ratio")
    return BookRunWorkflowPlanningRefs(
        arc_ids=valid_arc_ids,
        arc_completion_ratio=_bounded_ratio(ratio),
    )


def _bounded_ratio(value: object) -> float:
    ratio = _non_negative_float(value)
    return min(ratio, 1.0)


def _volume_plan_from_blueprint(blueprint: BookBlueprint, total_chapters: int) -> list[BookRunVolumePlanItem]:
    metadata = blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {}
    explicit = _explicit_volume_plan(metadata.get("volume_plan"), total_chapters)
    if explicit:
        return explicit
    volume_count = metadata.get("volume_count")
    if isinstance(volume_count, int) and volume_count > 0:
        return _even_volume_plan(min(volume_count, total_chapters), total_chapters)
    return _single_volume_plan(total_chapters)


def _require_longform_context_ready(
    session: Session,
    *,
    book_run: BookRun,
    blueprint: BookBlueprint,
    volume_plan: list[BookRunVolumePlanItem],
) -> None:
    """长篇或分卷 dispatch 前必须能证明跨章上下文真相源已就绪。"""

    if not _requires_longform_context(blueprint, volume_plan):
        return
    missing = _longform_context_missing_items(session, book_run=book_run)
    if missing:
        raise BookRunBlockedError(f"长篇上下文门禁未满足：{', '.join(missing)}。")


def _requires_longform_context(blueprint: BookBlueprint, volume_plan: list[BookRunVolumePlanItem]) -> bool:
    metadata = blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {}
    if metadata.get("longform_context_required") is True:
        return True
    if len(volume_plan) > 1:
        return True
    scale = metadata.get("story_scale") or metadata.get("workflow_type") or metadata.get("mode")
    return isinstance(scale, str) and scale.lower() in {"longform", "long", "novel", "volume", "serialized"}


def _longform_context_missing_items(session: Session, *, book_run: BookRun) -> list[str]:
    missing: list[str] = []
    if not _has_story_memory_context(session, book_run=book_run):
        missing.append("Story Memory")
    if not _has_character_bible_context(session, book_run=book_run):
        missing.append("Character Bible")
    if not _has_timeline_context(session, book_run=book_run):
        missing.append("Timeline")
    if not _has_foreshadow_context(session, book_run=book_run):
        missing.append("Foreshadow")
    return missing


def _has_story_memory_context(session: Session, *, book_run: BookRun) -> bool:
    atoms = list_memory_atoms(session, book_id=book_run.book_id)
    return any(
        atom.fact_type in {"status", "location", "rule", "knowledge", "plot_thread"}
        and not atom.source_ref.startswith("character_bible:")
        and "foreshadow_lifecycle" not in atom.value
        for atom in atoms
    )


def _has_character_bible_context(session: Session, *, book_run: BookRun) -> bool:
    return any(entry.sync_status == "synced" and entry.memory_atom_id for entry in list_character_bible_entries(session, book_id=book_run.book_id))


def _has_timeline_context(session: Session, *, book_run: BookRun) -> bool:
    return bool(list_timeline_events(session, book_id=book_run.book_id))


def _has_foreshadow_context(session: Session, *, book_run: BookRun) -> bool:
    lifecycle_atoms = list_memory_atoms(
        session,
        book_id=book_run.book_id,
        entity_type="subplot",
        fact_type="plot_thread",
    )
    states = ('"state": "planted"', '"state": "reinforced"', '"state": "paid_off"', '"state": "abandoned"')
    return any("foreshadow_lifecycle" in atom.value and any(state in atom.value for state in states) for atom in lifecycle_atoms)


def _explicit_volume_plan(value: object, total_chapters: int) -> list[BookRunVolumePlanItem]:
    if not isinstance(value, list):
        return []
    items: list[BookRunVolumePlanItem] = []
    for raw in value:
        if not isinstance(raw, dict):
            return []
        chapter_range = raw.get("chapter_range")
        if not isinstance(chapter_range, dict):
            return []
        volume_index = raw.get("volume_index")
        start = chapter_range.get("start")
        end = chapter_range.get("end")
        if not all(isinstance(item, int) and item > 0 for item in (volume_index, start, end)):
            return []
        if start > end or start > total_chapters:
            return []
        items.append(
            BookRunVolumePlanItem(
                volume_index=volume_index,
                chapter_range=BookRunChapterRange(start=start, end=min(end, total_chapters)),
            )
        )
    return items or _single_volume_plan(total_chapters)


def _even_volume_plan(volume_count: int, total_chapters: int) -> list[BookRunVolumePlanItem]:
    base = total_chapters // volume_count
    remainder = total_chapters % volume_count
    start = 1
    items: list[BookRunVolumePlanItem] = []
    for index in range(1, volume_count + 1):
        size = base + (1 if index <= remainder else 0)
        end = start + size - 1
        items.append(
            BookRunVolumePlanItem(
                volume_index=index,
                chapter_range=BookRunChapterRange(start=start, end=end),
            )
        )
        start = end + 1
    return items


def _single_volume_plan(total_chapters: int) -> list[BookRunVolumePlanItem]:
    return [
        BookRunVolumePlanItem(
            volume_index=1,
            chapter_range=BookRunChapterRange(start=1, end=total_chapters),
        )
    ]
