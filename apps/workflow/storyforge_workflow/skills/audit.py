from __future__ import annotations

from collections.abc import Mapping
from typing import Any

SKILL_CHAIN_VERSION = "bookrun-default-v1"


def derive_skill_chain_summary(progress: Mapping[str, Any]) -> dict[str, Any]:
    """从 BookLoop progress 只读派生技能链审计摘要。"""

    chapters = [_approved_chapter_summary(chapter) for chapter in _mapping_items(progress.get("completed_chapters"))]
    blocked_chapter = progress.get("blocked_chapter")
    if isinstance(blocked_chapter, Mapping):
        chapters.append(_blocked_chapter_summary(blocked_chapter))

    summary: dict[str, Any] = {
        "skill_chain_version": SKILL_CHAIN_VERSION,
        "chapters": chapters,
        "book_level_skills": _book_level_skills(progress),
        "book_status_projection": _book_status_projection(progress),
    }
    provider_degradation = progress.get("provider_degradation")
    if isinstance(provider_degradation, Mapping):
        summary["provider_degradation"] = dict(provider_degradation)
    return summary


def _approved_chapter_summary(chapter: Mapping[str, Any]) -> dict[str, Any]:
    skills = [_generate_skill(chapter), _judge_skill(chapter, "pass")]
    repair_patch_id = chapter.get("repair_patch_id")
    if repair_patch_id is not None:
        skills.append(_repair_skill(chapter))
    skills.append(_approve_skill(chapter))
    skills.append(_memory_skill(chapter))
    return {
        "chapter_index": chapter.get("chapter_index"),
        "status": "approved",
        "skills": skills,
    }


def _blocked_chapter_summary(chapter: Mapping[str, Any]) -> dict[str, Any]:
    skills = [_generate_skill(chapter), _judge_skill(chapter, "awaiting_review")]
    if chapter.get("repair_patch_id") is not None:
        skills.append(_repair_skill(chapter))
    return {
        "chapter_index": chapter.get("chapter_index"),
        "status": "awaiting_review",
        "skills": skills,
    }


def _generate_skill(chapter: Mapping[str, Any]) -> dict[str, Any]:
    skill = {"skill_name": "generate", "status": "generated", "model_run_id": chapter.get("model_run_id")}
    fallback_metadata = chapter.get("fallback_metadata")
    if fallback_metadata is not None:
        skill["fallback_metadata"] = fallback_metadata
    return skill


def _judge_skill(chapter: Mapping[str, Any], status: str) -> dict[str, Any]:
    return {"skill_name": "judge", "status": status, "judge_report_id": chapter.get("judge_report_id")}


def _repair_skill(chapter: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "skill_name": "repair",
        "status": "repaired",
        "repair_patch_id": chapter.get("repair_patch_id"),
        "source_judge_report_id": chapter.get("judge_report_id"),
    }


def _approve_skill(chapter: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "skill_name": "approve",
        "status": "approved",
        "approved_scene_id": chapter.get("approved_scene_id"),
        "source_model_run_id": chapter.get("model_run_id"),
        "judge_report_id": chapter.get("judge_report_id"),
    }


def _memory_skill(chapter: Mapping[str, Any]) -> dict[str, Any]:
    memory_atom_ids = list(chapter.get("memory_atom_ids") or [])
    status = "memory_updated" if memory_atom_ids else "memory_extract_skipped"
    return {"skill_name": "memory_extract", "status": status, "memory_atom_ids": memory_atom_ids}


def _book_level_skills(progress: Mapping[str, Any]) -> list[dict[str, Any]]:
    artifact_ids = progress.get("artifact_ids")
    if artifact_ids is None:
        return []
    return [{"skill_name": "export", "status": "exported", "artifact_ids": list(artifact_ids)}]


def _book_status_projection(progress: Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(progress.get("provider_degradation"), Mapping):
        return {"status": "paused_by_provider_degradation", "pause_reason": None}
    pause_reason = progress.get("pause_reason")
    if pause_reason is not None:
        return {"status": "paused_by_budget", "pause_reason": pause_reason}
    if isinstance(progress.get("blocked_chapter"), Mapping):
        return {"status": "awaiting_review", "pause_reason": None}
    return {"status": "completed", "pause_reason": None}


def _mapping_items(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))
