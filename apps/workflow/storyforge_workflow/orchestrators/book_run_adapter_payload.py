from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from storyforge_workflow.orchestrators.book_loop import ConsistencyBarrier
from storyforge_workflow.orchestrators.book_run_adapter_coerce import _optional_positive_int
from storyforge_workflow.orchestrators.book_run_adapter_types import BookRunAdapterRequest
from storyforge_workflow.quality.arc_consistency import ArcConsistencyBarrier


def _chapter_dispatch_map(value: object) -> dict[int, dict[str, Any]]:
    chapters: dict[int, dict[str, Any]] = {}
    if not isinstance(value, list):
        return chapters
    for item in value:
        if not isinstance(item, Mapping):
            continue
        chapter_index = _optional_positive_int(item.get("chapter_index"))
        chapter_id = _optional_positive_int(item.get("chapter_id"))
        chapter_goal = item.get("chapter_goal")
        if chapter_index is None or chapter_id is None or not isinstance(chapter_goal, str) or not chapter_goal.strip():
            continue
        chapters[chapter_index] = {
            "chapter_id": chapter_id,
            "chapter_goal": chapter_goal,
            "planning_refs": _planning_refs_or_none(item.get("planning_refs")),
        }
    return chapters


def _build_arc_barrier_if_planning_present(chapters: dict[int, dict[str, Any]]) -> ConsistencyBarrier | None:
    """dispatch 含弧线引用时默认启用弧线到期检查；无规划则保持现有行为。"""

    if any(isinstance(chapter.get("planning_refs"), Mapping) for chapter in chapters.values()):
        return ArcConsistencyBarrier(chapters)
    return None


def _planning_refs_or_none(value: object) -> dict[str, Any] | None:
    """只保留轻量 arc 引用，损坏字段一律降级为 None，保持现有放行行为。"""

    if not isinstance(value, Mapping):
        return None
    raw_arc_ids = value.get("arc_ids")
    arc_ids = (
        [arc_id for arc_id in raw_arc_ids if isinstance(arc_id, str) and arc_id.strip()]
        if isinstance(raw_arc_ids, list)
        else []
    )
    if not arc_ids:
        return None
    ratio = value.get("arc_completion_ratio")
    bounded = float(ratio) if isinstance(ratio, int | float) and 0 <= ratio <= 1 else 0.0
    return {"arc_ids": arc_ids, "arc_completion_ratio": bounded}


def _locked_narrative_plan_or_raise(value: object) -> dict[str, Any]:
    narrative_plan = _object_mapping(value)
    if narrative_plan is None or narrative_plan.get("locked") is not True:
        raise ValueError("BookRun dispatch payload requires narrative_plan locked=True before generation.")
    return narrative_plan


def _narrative_plan_progress_summary(
    narrative_plan: Mapping[str, Any],
    *,
    beat_sheet_gate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    summary: dict[str, Any] = {"locked": True}
    for source_key, target_key in (
        ("plan_id", "plan_id"),
        ("id", "plan_id"),
        ("summary", "summary"),
        ("premise", "premise"),
        ("truth", "truth"),
        ("protagonist_arc", "protagonist_arc"),
        ("antagonist_motive", "antagonist_motive"),
    ):
        if target_key in summary:
            continue
        value = narrative_plan.get(source_key)
        if value is not None and _is_light_scalar(value):
            summary[target_key] = value
    if beat_sheet_gate is not None:
        summary["beat_sheet_gate"] = dict(beat_sheet_gate)
    return summary


def _chapter_beats_summary(narrative_plan: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_beats = narrative_plan.get("chapter_beats")
    if not isinstance(raw_beats, list | tuple):
        return []
    beats: list[dict[str, Any]] = []
    for raw_beat in raw_beats:
        beat = _object_mapping(raw_beat)
        if beat is None:
            continue
        summary = _mapping_summary(beat)
        if summary is not None:
            beats.append(summary)
    return beats


def _chapter_beat_for_index(request: BookRunAdapterRequest, chapter_index: int) -> dict[str, Any] | None:
    for beat in request.chapter_beats:
        raw_index = beat.get("chapter_index", beat.get("chapter"))
        if raw_index == chapter_index:
            return dict(beat)
    return None


def _mapping_summary(value: object) -> dict[str, Any] | None:
    mapping = _object_mapping(value)
    if mapping is None:
        return None
    summary: dict[str, Any] = {}
    for key, raw_value in mapping.items():
        if not isinstance(key, str) or _is_full_text_key(key):
            continue
        sanitized = _sanitize_summary_value(raw_value)
        if sanitized is not None:
            summary[key] = sanitized
    return summary


def _sanitize_summary_value(value: object) -> Any:
    if _is_light_scalar(value):
        return value
    if isinstance(value, Mapping):
        return _mapping_summary(value)
    if _is_dataclass_like(value):
        return _mapping_summary(value)
    if isinstance(value, list | tuple):
        items = [_sanitize_summary_value(item) for item in value]
        return [item for item in items if item is not None]
    return None


def _object_mapping(value: object) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return dict(value)
    compact_summary = getattr(value, "compact_summary", None)
    if callable(compact_summary):
        summary = compact_summary()
        if isinstance(summary, Mapping):
            mapping = dict(summary)
            if hasattr(value, "locked"):
                mapping.setdefault("locked", value.locked)
            return mapping
    if _is_dataclass_like(value):
        return dict(vars(value))
    return None


def _is_dataclass_like(value: object) -> bool:
    return hasattr(value, "__dataclass_fields__") and hasattr(value, "__dict__")


def _is_light_scalar(value: object) -> bool:
    return isinstance(value, bool | int | float) or (isinstance(value, str) and len(value) <= 240)


def _is_full_text_key(key: str) -> bool:
    normalized = key.lower()
    return any(fragment in normalized for fragment in ("full", "draft", "正文", "prompt", "manuscript"))


def _required_int(payload: Mapping[str, Any], key: str) -> int:
    value = _optional_positive_int(payload.get(key))
    if value is None:
        raise ValueError(f"BookRun dispatch payload 缺少有效字段：{key}。")
    return value
