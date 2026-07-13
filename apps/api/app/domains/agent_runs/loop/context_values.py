from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from typing import Any

from app.domains.agent_runs._text import compact_text, ordered_unique

CHAPTER_TEXT_LIMIT = 1200


_UNSAFE_CONTEXT_KEYS = frozenset(
    {
        "agent_events",
        "debug",
        "debug_json",
        "events",
        "event_log",
        "patch",
        "patch_metadata",
        "permission",
        "permission_payload",
        "permissions",
        "proposed_patch",
        "timeline",
        "timeline_events",
        "tool_trace",
        "ui_debug",
        "ui_debug_json",
    }
)


_UNSAFE_FILE_KINDS = frozenset({"artifact", "debug", "event", "export", "patch", "permission", "quality"})


_CHAPTER_CONTEXT_KEYS = (
    "book_id",
    "chapter_id",
    "chapter",
    "chapter_number",
    "ordinal",
    "chapter_title",
    "title",
    "scene_id",
    "scene_title",
    "summary",
    "previous_summary",
    "next_summary",
    "goal",
    "pov",
    "setting",
    "beat",
    "beats",
    "outline",
    "chapter_outline",
    "current_scene",
)


def _safe_context_value(value: object) -> object | None:
    if isinstance(value, str):
        return compact_text(value, limit=CHAPTER_TEXT_LIMIT)
    if isinstance(value, bool | int | float):
        return value
    if isinstance(value, list):
        safe_list = [_safe_context_value(item) for item in value[:12]]
        return [item for item in safe_list if item is not None]
    return None


def _omitted_summary(
    bundle: Mapping[str, Any] | None,
    *,
    event_history: Iterable[object] | None,
    artifacts: Iterable[object] | None,
    unsafe_file_count: int,
) -> dict[str, int]:
    raw_event_count = sum(1 for _ in event_history) if event_history is not None else 0
    unsafe_context_key_count = 0
    if bundle is not None:
        unsafe_context_key_count = sum(1 for key in bundle if str(key) in _UNSAFE_CONTEXT_KEYS)
    artifact_payload_count = 0
    if artifacts is not None:
        artifact_payload_count = sum(1 for artifact in artifacts if _artifact_kind(artifact) != "review_report")
    return {
        "raw_event_count": raw_event_count,
        "unsafe_context_key_count": unsafe_context_key_count,
        "unsafe_context_file_count": unsafe_file_count,
        "artifact_payload_count": artifact_payload_count,
    }


def _included_sections(
    *,
    project: Mapping[str, Any],
    context_files: list[dict[str, Any]],
    review_report: Mapping[str, Any] | None,
    story_memory: Mapping[str, Any],
    chapter_context: Mapping[str, Any],
) -> list[str]:
    sections = ["run", "selected_file"]
    if project:
        sections.append("project")
    if context_files:
        sections.append("context_files")
    if isinstance(review_report, Mapping) and review_report:
        sections.append("review_report")
    if _story_memory_count(story_memory):
        sections.append("story_memory")
    if chapter_context:
        sections.append("chapter_context")
    return sections


def _story_memory_count(story_memory: object) -> int:
    if not isinstance(story_memory, Mapping):
        return 0
    items = story_memory.get("items")
    return len(items) if isinstance(items, list) else 0


def _looks_like_harness_payload(text: str) -> bool:
    stripped = text.strip()
    if not stripped or stripped[0] not in "[{":
        return False
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return False
    return _contains_unsafe_key(parsed)


def _contains_unsafe_key(value: object) -> bool:
    if isinstance(value, Mapping):
        if any(str(key) in _UNSAFE_CONTEXT_KEYS for key in value):
            return True
        return any(_contains_unsafe_key(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_unsafe_key(item) for item in value)
    return False


def _matches_selected_file(path: str | None, selected_refs: list[str]) -> bool:
    if path is None:
        return False
    normalized = _normalize_path(path)
    if not normalized:
        return False
    for selected in selected_refs:
        selected_normalized = _normalize_path(selected)
        if not selected_normalized:
            continue
        if normalized == selected_normalized:
            return True
        if selected_normalized.endswith(f"/{normalized}") or normalized.endswith(f"/{selected_normalized}"):
            return True
    return False


def _normalize_path(path: str) -> str:
    return path.replace("\\", "/").strip().strip("/").lower()


def _artifact_kind(artifact: object) -> str | None:
    value = _value(artifact, "kind")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _artifact_payload(artifact: object) -> Mapping[str, Any] | None:
    value = _value(artifact, "payload")
    return value if isinstance(value, Mapping) else None


def _value(source: object, key: str) -> object | None:
    if isinstance(source, Mapping):
        return source.get(key)
    return getattr(source, key, None)


def _first_string(source: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _string_list(values: Iterable[str] | None) -> list[str]:
    if values is None:
        return []
    return ordered_unique([value.strip() for value in values if isinstance(value, str) and value.strip()])


def _string_or_default(value: object, default: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else default


UNSAFE_CONTEXT_KEYS = _UNSAFE_CONTEXT_KEYS
UNSAFE_FILE_KINDS = _UNSAFE_FILE_KINDS
CHAPTER_CONTEXT_KEYS = _CHAPTER_CONTEXT_KEYS
safe_context_value = _safe_context_value
omitted_summary = _omitted_summary
included_sections = _included_sections
story_memory_count = _story_memory_count
looks_like_harness_payload = _looks_like_harness_payload
contains_unsafe_key = _contains_unsafe_key
matches_selected_file = _matches_selected_file
normalize_path = _normalize_path
artifact_kind = _artifact_kind
artifact_payload = _artifact_payload
value = _value
first_string = _first_string
string_list = _string_list
string_or_default = _string_or_default
