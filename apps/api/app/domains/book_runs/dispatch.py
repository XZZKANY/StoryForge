"""BookRun 域 Workflow Dispatch 构建。

把锁定的 Blueprint 与已规划的 Chapter 装配为 workflow worker 可消费的调度 payload。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs._coerce import _bounded_ratio, _compact_text, _compact_text_list, _positive_int
from app.domains.book_runs.gate import (
    _even_volume_plan,
    _explicit_volume_plan,
    _require_longform_context_ready,
    _single_volume_plan,
)
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import (
    BookRunVolumePlanItem,
    BookRunWorkflowChapter,
    BookRunWorkflowDispatch,
    BookRunWorkflowPlanningRefs,
)
from app.domains.books.models import Chapter

DEFAULT_ENTITY_BUDGET = {
    "key_characters": 5,
    "core_locations": 3,
    "core_evidence": 3,
    "major_reversals": 2,
}
DEFAULT_PHASE_POLICY = {
    "phases": [
        {"name": "setup", "chapter_range": {"start": 1, "end": 6}},
        {"name": "investigation", "chapter_range": {"start": 7, "end": 15}},
        {"name": "reversal", "chapter_range": {"start": 16, "end": 24}},
        {"name": "resolution", "chapter_range": {"start": 25, "end": 30}},
    ]
}


def build_book_run_workflow_dispatch(session: Session, book_run_id: int) -> BookRunWorkflowDispatch:
    """生成 workflow worker 可消费的 BookRun 调度 payload，但不执行 workflow。"""

    from app.domains.book_runs.service import BookRunBlockedError, get_book_run

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
    narrative_plan = _workflow_narrative_plan(blueprint, chapters_by_index, book_run.total_chapters)
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
        narrative_plan=narrative_plan,
        entity_budget=_default_entity_budget(),
        phase_policy=_default_phase_policy(),
        beat_sheet_gate=_beat_sheet_gate(narrative_plan),
    )


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


def _workflow_narrative_plan(
    blueprint: BookBlueprint,
    chapters_by_index: dict[int, Chapter],
    total_chapters: int,
) -> dict[str, object]:
    metadata = blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {}
    raw_plan = metadata.get("narrative_plan")
    if isinstance(raw_plan, dict) and raw_plan.get("locked") is True:
        return _metadata_narrative_plan_summary(raw_plan)
    return _generated_default_narrative_plan(blueprint, chapters_by_index, total_chapters)


def _metadata_narrative_plan_summary(raw_plan: dict) -> dict[str, object]:
    summary: dict[str, object] = {
        "locked": True,
        "source": "metadata",
        "generated": False,
    }
    for key in ("premise", "truth", "protagonist_arc", "antagonist_motive"):
        value = _compact_text(raw_plan.get(key))
        if value:
            summary[key] = value
    summary["allowed_entities"] = _allowed_entities_summary(raw_plan.get("allowed_entities"))
    summary["major_reversals"] = _major_reversals_summary(raw_plan.get("major_reversals"))
    summary["chapter_beats"] = _chapter_beats_summary(raw_plan.get("chapter_beats"))
    return summary


def _generated_default_narrative_plan(
    blueprint: BookBlueprint,
    chapters_by_index: dict[int, Chapter],
    total_chapters: int,
) -> dict[str, object]:
    locations = sorted(
        {
            location
            for chapter in chapters_by_index.values()
            if (location := _compact_text(getattr(chapter, "location", None), max_length=120))
        }
    )
    chapter_beats = [
        {
            "chapter_index": index,
            "beat": _chapter_goal(chapters_by_index[index]),
        }
        for index in sorted(chapters_by_index)
        if 1 <= index <= total_chapters
    ]
    return {
        "locked": True,
        "source": "generated_default",
        "generated": True,
        "premise": _compact_text(blueprint.premise),
        "truth": _compact_text(f"围绕核心前提完成证据闭环：{blueprint.premise}"),
        "protagonist_arc": "主角按章节计划从发现问题推进到完成关键验证。",
        "antagonist_motive": "反对力量围绕核心冲突阻止真相被确认。",
        "allowed_entities": {
            "characters": [],
            "locations": locations[: DEFAULT_ENTITY_BUDGET["core_locations"]],
            "evidence": [],
        },
        "major_reversals": _default_major_reversals(chapter_beats, total_chapters),
        "chapter_beats": chapter_beats,
    }


def _allowed_entities_summary(value: object) -> dict[str, list[str]]:
    source = value if isinstance(value, dict) else {}
    return {
        "characters": _compact_text_list(
            source.get("characters", source.get("key_characters")),
            DEFAULT_ENTITY_BUDGET["key_characters"],
        ),
        "locations": _compact_text_list(
            source.get("locations", source.get("core_locations")),
            DEFAULT_ENTITY_BUDGET["core_locations"],
        ),
        "evidence": _compact_text_list(
            source.get("evidence", source.get("core_evidence")),
            DEFAULT_ENTITY_BUDGET["core_evidence"],
        ),
    }


def _major_reversals_summary(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    reversals: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        chapter_index = _positive_int(item.get("chapter_index"))
        summary = _compact_text(item.get("summary") or item.get("beat") or item.get("title"))
        if chapter_index is None or not summary:
            continue
        reversals.append({"chapter_index": chapter_index, "summary": summary})
        if len(reversals) >= DEFAULT_ENTITY_BUDGET["major_reversals"]:
            break
    return reversals


def _chapter_beats_summary(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    beats: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        chapter_index = _positive_int(item.get("chapter_index"))
        beat = _compact_text(item.get("beat") or item.get("summary") or item.get("goal"))
        if chapter_index is None or not beat:
            continue
        beats.append({"chapter_index": chapter_index, "beat": beat})
    return beats


def _default_major_reversals(chapter_beats: list[dict[str, object]], total_chapters: int) -> list[dict[str, object]]:
    if not chapter_beats:
        return []
    indexes = sorted({max(1, min(total_chapters, round(total_chapters * ratio))) for ratio in (0.5, 0.8)})
    by_index = {beat["chapter_index"]: beat["beat"] for beat in chapter_beats}
    reversals: list[dict[str, object]] = []
    for index in indexes:
        beat = by_index.get(index)
        if isinstance(beat, str) and beat:
            reversals.append({"chapter_index": index, "summary": beat})
    return reversals[: DEFAULT_ENTITY_BUDGET["major_reversals"]]


def _default_entity_budget() -> dict[str, int]:
    return dict(DEFAULT_ENTITY_BUDGET)


def _default_phase_policy() -> dict[str, object]:
    return {
        "phases": [
            {
                "name": phase["name"],
                "chapter_range": dict(phase["chapter_range"]),
            }
            for phase in DEFAULT_PHASE_POLICY["phases"]
        ]
    }


def _beat_sheet_gate(narrative_plan: dict[str, object]) -> dict[str, object]:
    chapter_beats = narrative_plan.get("chapter_beats")
    return {
        "status": "pass",
        "locked": narrative_plan.get("locked") is True,
        "chapter_count": len(chapter_beats) if isinstance(chapter_beats, list) else 0,
        "source": narrative_plan.get("source") or "unknown",
    }


def _volume_plan_from_blueprint(blueprint: BookBlueprint, total_chapters: int) -> list[BookRunVolumePlanItem]:
    metadata = blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {}
    explicit = _explicit_volume_plan(metadata.get("volume_plan"), total_chapters)
    if explicit:
        return explicit
    volume_count = metadata.get("volume_count")
    if isinstance(volume_count, int) and volume_count > 0:
        return _even_volume_plan(min(volume_count, total_chapters), total_chapters)
    return _single_volume_plan(total_chapters)
