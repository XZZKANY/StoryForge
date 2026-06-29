from __future__ import annotations

from typing import Any

from storyforge_workflow.orchestrators.book_loop_types import (
    BookLoopResult,
    ChapterConsistencyReport,
)
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


def _consistency_blocked_result(
    chapter_index: int,
    chapter_result: NovelLoopResult,
    completed: list[dict[str, Any]],
    checkpoint: list[dict[str, Any]],
    budget: dict[str, int | float],
    report: ChapterConsistencyReport,
    generated_but_uncommitted: list[dict[str, Any]] | None = None,
) -> BookLoopResult:
    """跨章一致性冲突时阻断该章，沿用 awaiting_review 流程并附带冲突明细。"""

    blocked_chapter = _chapter_progress(chapter_index, chapter_result)
    blocked_chapter["consistency_conflicts"] = list(report.conflicts)
    progress = {
        "completed_chapters": completed,
        "checkpoint": checkpoint,
        "blocked_chapter": blocked_chapter,
        "budget": dict(budget),
        "consistency_conflict": {
            "chapter_index": chapter_index,
            "conflicts": list(report.conflicts),
        },
    }
    if generated_but_uncommitted:
        progress["generated_but_uncommitted"] = list(generated_but_uncommitted)
    return BookLoopResult(
        status="awaiting_review",
        current_chapter_index=chapter_index,
        progress=progress,
    )


def _generated_but_uncommitted_after(
    blocked_chapter_index: int,
    pending_results: dict[int, NovelLoopResult],
) -> list[dict[str, Any]]:
    return [
        {"chapter_index": chapter_index, "status": "generated"}
        for chapter_index in sorted(pending_results)
        if chapter_index > blocked_chapter_index
    ]


def _chapter_progress(chapter_index: int, result: NovelLoopResult) -> dict[str, Any]:
    return {
        "chapter_index": chapter_index,
        "status": result.status,
        "model_run_id": result.source_model_run_id,
        "judge_report_id": result.judge_report_id,
        "repair_patch_id": result.repair_patch_id,
        "approved_scene_id": result.approved_scene_id,
        "token_usage": result.token_usage,
        "elapsed_time_sec": result.elapsed_time_sec,
        "cost_estimate": result.cost_estimate,
        "fallback_metadata": result.fallback_metadata,
        "memory_atom_ids": list(result.memory_atom_ids),
        "continuity_edge_count": result.continuity_edge_count,
        "skill_runs": list(result.skill_runs),
    }


def _checkpoint_entry(chapter_progress: dict[str, Any]) -> dict[str, Any]:
    return {
        "chapter_index": chapter_progress["chapter_index"],
        "status": chapter_progress["status"],
        "model_run_id": chapter_progress["model_run_id"],
        "judge_report_id": chapter_progress["judge_report_id"],
        "approved_scene_id": chapter_progress["approved_scene_id"],
        "token_usage": chapter_progress["token_usage"],
        "elapsed_time_sec": chapter_progress["elapsed_time_sec"],
        "cost_estimate": chapter_progress["cost_estimate"],
        "memory_atom_ids": list(chapter_progress.get("memory_atom_ids") or []),
        "continuity_edge_count": chapter_progress.get("continuity_edge_count", 0),
        "skill_runs": list(chapter_progress["skill_runs"]),
    }
