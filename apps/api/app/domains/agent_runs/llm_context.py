from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from typing import Any

from app.domains.agent_runs._text import _compact_text, _ordered_unique

SNAPSHOT_VERSION = 1
SELECTED_FILE_TEXT_LIMIT = 12000
CONTEXT_FILE_TEXT_LIMIT = 2000
MEMORY_TEXT_LIMIT = 800
CHAPTER_TEXT_LIMIT = 1200
REVIEW_TEXT_LIMIT = 600
MAX_CONTEXT_FILES = 8
MAX_REVIEW_ISSUES = 12
MAX_STORY_MEMORY_ITEMS = 8

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


def build_llm_context_snapshot(
    *,
    run_state: object | None,
    intent: str,
    user_message: str,
    file_path: str,
    content: str,
    context_bundle: object | None,
    role_hints: Iterable[str] | None = None,
    role_mentions: Iterable[str] | None = None,
    review_report: object | None = None,
    artifacts: Iterable[object] | None = None,
    event_history: Iterable[object] | None = None,
) -> dict[str, Any]:
    """Build a deterministic model-context snapshot from whitelisted author context."""

    artifact_items = list(artifacts) if artifacts is not None else None
    event_items = list(event_history) if event_history is not None else None
    bundle = context_bundle if isinstance(context_bundle, Mapping) else None
    warnings: list[str] = []
    if context_bundle is not None and bundle is None:
        warnings.append("context_bundle ignored because it was not an object")

    context_files, file_warnings, unsafe_file_count = _context_files(bundle, file_path=file_path)
    warnings.extend(file_warnings)
    review_summary = _review_report_summary(review_report) or _review_report_from_artifacts(artifact_items)
    story_memory = _story_memory_summary(bundle)
    chapter_context = _chapter_context_summary(bundle)
    project = _project_summary(bundle)
    omitted = _omitted_summary(
        bundle,
        event_history=event_items,
        artifacts=artifact_items,
        unsafe_file_count=unsafe_file_count,
    )
    included_sections = _included_sections(
        project=project,
        context_files=context_files,
        review_report=review_summary,
        story_memory=story_memory,
        chapter_context=chapter_context,
    )

    snapshot = {
        "kind": "llm_context_snapshot",
        "version": SNAPSHOT_VERSION,
        "intent": _string_or_default(intent, "unknown"),
        "run": _run_state(run_state),
        "user_goal": _compact_text(user_message, limit=2000),
        "selected_file": {
            "file_path": _string_or_default(file_path, "unknown"),
            "content_chars": len(content) if isinstance(content, str) else 0,
            "content_excerpt": _compact_text(content, limit=SELECTED_FILE_TEXT_LIMIT),
        },
        "role_hints": _string_list(role_hints),
        "role_mentions": _string_list(role_mentions),
        "project": project,
        "context_files": context_files,
        "review_report": review_summary,
        "story_memory": story_memory,
        "chapter_context": chapter_context,
        "included_sections": included_sections,
        "warnings": warnings,
        "omitted": omitted,
    }
    return _with_snapshot_id(snapshot)


def llm_context_snapshot_trace_summary(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    context_files = snapshot.get("context_files")
    story_memory = snapshot.get("story_memory")
    chapter_context = snapshot.get("chapter_context")
    review_report = snapshot.get("review_report")
    included_sections = snapshot.get("included_sections")
    warnings = snapshot.get("warnings")
    return {
        "snapshot_id": snapshot.get("snapshot_id"),
        "section_count": len(included_sections) if isinstance(included_sections, list) else 0,
        "context_file_count": len(context_files) if isinstance(context_files, list) else 0,
        "story_memory_count": _story_memory_count(story_memory),
        "has_chapter_context": bool(chapter_context),
        "has_review_report": isinstance(review_report, Mapping) and bool(review_report),
        "warning_count": len(warnings) if isinstance(warnings, list) else 0,
    }


def llm_context_snapshot_to_prompt_context_bundle(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Convert a snapshot back into the legacy context_bundle shape used by current prompts."""

    selected_file = snapshot.get("selected_file") if isinstance(snapshot.get("selected_file"), Mapping) else {}
    project = snapshot.get("project") if isinstance(snapshot.get("project"), Mapping) else {}
    context_files = snapshot.get("context_files") if isinstance(snapshot.get("context_files"), list) else []
    files = [_prompt_context_file(item) for item in context_files if isinstance(item, Mapping)]
    story_memory_file = _story_memory_prompt_file(snapshot.get("story_memory"))
    if story_memory_file is not None:
        files.append(story_memory_file)
    chapter_context_file = _chapter_context_prompt_file(snapshot.get("chapter_context"))
    if chapter_context_file is not None:
        files.append(chapter_context_file)

    current_file = _first_string(project, "current_file") or _first_string(selected_file, "file_path") or "unknown"
    summary: dict[str, Any] = {}
    counts = project.get("counts")
    if isinstance(counts, Mapping):
        summary["counts"] = dict(counts)
    has_story_structure = project.get("has_story_structure")
    if isinstance(has_story_structure, bool):
        summary["hasStoryStructure"] = has_story_structure

    return {
        "project_root": _first_string(project, "project_root") or "storyforge://llm-context",
        "current_file": current_file,
        "files": files,
        "summary": summary,
        "budget": {
            "file_count": len(files),
            "char_count": sum(len(str(item.get("excerpt") or "")) for item in files),
            "max_files": MAX_CONTEXT_FILES,
            "max_excerpt_chars": CONTEXT_FILE_TEXT_LIMIT,
            "truncated": False,
        },
    }


def _with_snapshot_id(snapshot: dict[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    snapshot_id = f"llmctx-{hashlib.sha256(encoded.encode('utf-8')).hexdigest()[:16]}"
    return {**snapshot, "snapshot_id": snapshot_id}


def _prompt_context_file(item: Mapping[str, Any]) -> dict[str, str]:
    relative_path = _first_string(item, "relative_path") or "unknown"
    kind = _first_string(item, "kind") or "other"
    title = _first_string(item, "title") or relative_path
    excerpt = _first_string(item, "excerpt") or ""
    return {
        "path": relative_path,
        "relative_path": relative_path,
        "kind": kind,
        "title": title,
        "excerpt": _compact_text(excerpt, limit=CONTEXT_FILE_TEXT_LIMIT) or "无摘录。",
    }


def _story_memory_prompt_file(story_memory: object) -> dict[str, str] | None:
    if not isinstance(story_memory, Mapping):
        return None
    items = story_memory.get("items")
    if not isinstance(items, list) or not items:
        return None
    lines: list[str] = []
    for item in items[:MAX_STORY_MEMORY_ITEMS]:
        if not isinstance(item, Mapping):
            continue
        label_parts = [_first_string(item, "entity"), _first_string(item, "kind")]
        label = " / ".join(part for part in label_parts if part)
        text = _first_string(item, "text")
        if text is not None:
            lines.append(f"- {label}: {text}" if label else f"- {text}")
    if not lines:
        return None
    return _synthetic_prompt_file(
        relative_path="Story Memory",
        kind="story_memory",
        title="Story Memory",
        excerpt="\n".join(lines),
    )


def _chapter_context_prompt_file(chapter_context: object) -> dict[str, str] | None:
    if not isinstance(chapter_context, Mapping) or not chapter_context:
        return None
    lines = [f"- {key}: {value}" for key, value in chapter_context.items() if isinstance(value, str | int | float | bool | list)]
    if not lines:
        return None
    return _synthetic_prompt_file(
        relative_path="Chapter Context",
        kind="chapter_context",
        title="Chapter Context",
        excerpt="\n".join(lines),
    )


def _synthetic_prompt_file(*, relative_path: str, kind: str, title: str, excerpt: str) -> dict[str, str]:
    return {
        "path": f"storyforge://llm-context/{kind}",
        "relative_path": relative_path,
        "kind": kind,
        "title": title,
        "excerpt": _compact_text(excerpt, limit=CONTEXT_FILE_TEXT_LIMIT) or "无摘录。",
    }


def _run_state(run_state: object | None) -> dict[str, Any]:
    if run_state is None:
        return {}
    public_id = _value(run_state, "public_id") or _value(run_state, "run_id")
    goal = _value(run_state, "goal")
    status = _value(run_state, "status")
    current_step = _value(run_state, "current_step")
    result: dict[str, Any] = {}
    if isinstance(public_id, str) and public_id.strip():
        result["run_id"] = public_id.strip()
    if isinstance(goal, str) and goal.strip():
        result["goal"] = _compact_text(goal, limit=2000)
    if isinstance(status, str) and status.strip():
        result["status"] = status.strip()
    if isinstance(current_step, str) and current_step.strip():
        result["current_step"] = current_step.strip()
    return result


def _project_summary(bundle: Mapping[str, Any] | None) -> dict[str, Any]:
    if bundle is None:
        return {}
    result: dict[str, Any] = {}
    project_root = _first_string(bundle, "project_root", "projectRoot")
    current_file = _first_string(bundle, "current_file", "currentFile")
    if project_root is not None:
        result["project_root"] = project_root
    if current_file is not None:
        result["current_file"] = current_file
    summary = bundle.get("summary")
    if isinstance(summary, Mapping):
        has_story_structure = summary.get("hasStoryStructure")
        if isinstance(has_story_structure, bool):
            result["has_story_structure"] = has_story_structure
        counts = summary.get("counts")
        if isinstance(counts, Mapping):
            safe_counts = {
                str(key): value
                for key, value in sorted(counts.items(), key=lambda item: str(item[0]))
                if isinstance(value, int | float)
            }
            if safe_counts:
                result["counts"] = safe_counts
    return result


def _context_files(
    bundle: Mapping[str, Any] | None,
    *,
    file_path: str,
) -> tuple[list[dict[str, Any]], list[str], int]:
    if bundle is None:
        return [], [], 0
    files = bundle.get("files")
    if files is None:
        return [], [], 0
    if not isinstance(files, list):
        return [], ["context_bundle.files ignored because it was not a list"], 0

    current_file = _first_string(bundle, "current_file", "currentFile")
    selected_refs = [file_path, current_file or ""]
    result: list[dict[str, Any]] = []
    warnings: list[str] = []
    unsafe_count = 0
    for item in files:
        if len(result) >= MAX_CONTEXT_FILES:
            break
        if not isinstance(item, Mapping):
            warnings.append("context_bundle.files item ignored because it was not an object")
            continue
        kind = _first_string(item, "kind") or "other"
        excerpt = _first_string(item, "excerpt") or ""
        if kind in _UNSAFE_FILE_KINDS or _looks_like_harness_payload(excerpt):
            unsafe_count += 1
            continue
        relative_path = _first_string(item, "relative_path", "relativePath", "path")
        path = _first_string(item, "path")
        if _matches_selected_file(relative_path, selected_refs) or _matches_selected_file(path, selected_refs):
            continue
        title = _first_string(item, "title", "name")
        context_file: dict[str, Any] = {
            "relative_path": relative_path or path or "unknown",
            "kind": kind,
            "title": title or relative_path or path or "untitled",
        }
        if excerpt:
            context_file["excerpt"] = _compact_text(excerpt, limit=CONTEXT_FILE_TEXT_LIMIT)
            context_file["excerpt_chars"] = len(excerpt)
        result.append(context_file)
    return result, warnings, unsafe_count


def _review_report_summary(report: object | None) -> dict[str, Any] | None:
    if not isinstance(report, Mapping):
        return None
    issues = report.get("issues")
    safe_issues = [_review_issue_summary(item) for item in issues[:MAX_REVIEW_ISSUES] if isinstance(item, Mapping)] if isinstance(issues, list) else []
    suggested_actions = report.get("suggested_actions")
    safe_actions = [
        _compact_text(item, limit=REVIEW_TEXT_LIMIT)
        for item in suggested_actions[:MAX_REVIEW_ISSUES]
        if isinstance(item, str) and item.strip()
    ] if isinstance(suggested_actions, list) else []
    summary: dict[str, Any] = {
        "kind": _first_string(report, "kind") or "review_report",
        "issue_count": len(issues) if isinstance(issues, list) else 0,
        "issues": safe_issues,
        "suggested_actions": safe_actions,
    }
    file_path = _first_string(report, "file_path", "filePath")
    mode = _first_string(report, "mode")
    if file_path is not None:
        summary["file_path"] = file_path
    if mode is not None:
        summary["mode"] = mode
    return summary


def _review_issue_summary(issue: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in ("id", "category", "severity", "agent", "code"):
        value = _first_string(issue, key)
        if value is not None:
            result[key] = value
    for key in ("message", "evidence", "suggested_action"):
        value = _first_string(issue, key)
        if value is not None:
            result[key] = _compact_text(value, limit=REVIEW_TEXT_LIMIT)
    return result


def _review_report_from_artifacts(artifacts: Iterable[object] | None) -> dict[str, Any] | None:
    if artifacts is None:
        return None
    for artifact in artifacts:
        kind = _artifact_kind(artifact)
        payload = _artifact_payload(artifact)
        if kind == "review_report" and payload is not None:
            return _review_report_summary(payload)
    return None


def _story_memory_summary(bundle: Mapping[str, Any] | None) -> dict[str, Any]:
    source = _story_memory_source(bundle)
    if source is None:
        return {"items": []}
    items = source if isinstance(source, list) else None
    if isinstance(source, Mapping):
        for key in ("items", "atoms", "memories"):
            value = source.get(key)
            if isinstance(value, list):
                items = value
                break
    if not isinstance(items, list):
        return {"items": []}
    safe_items = [_memory_item_summary(item) for item in items[:MAX_STORY_MEMORY_ITEMS] if isinstance(item, Mapping)]
    return {"items": [item for item in safe_items if item]}


def _story_memory_source(bundle: Mapping[str, Any] | None) -> object | None:
    if bundle is None:
        return None
    for key in ("story_memory", "storyMemory", "memory", "memories"):
        if key in bundle:
            return bundle.get(key)
    return None


def _memory_item_summary(item: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for output_key, keys in {
        "memory_id": ("memory_id", "memoryId", "id"),
        "kind": ("kind", "category", "type"),
        "entity": ("entity", "name", "subject"),
    }.items():
        value = _first_string(item, *keys)
        if value is not None:
            result[output_key] = value
    text = _first_string(item, "fact", "content", "text", "summary")
    if text is not None:
        result["text"] = _compact_text(text, limit=MEMORY_TEXT_LIMIT)
    for key in ("source_chapter_id", "valid_from_chapter", "valid_to_chapter"):
        value = item.get(key)
        if isinstance(value, int):
            result[key] = value
    return result


def _chapter_context_summary(bundle: Mapping[str, Any] | None) -> dict[str, Any]:
    if bundle is None:
        return {}
    source = None
    for key in ("chapter_context", "chapterContext", "chapter", "scene_packet", "scenePacket"):
        value = bundle.get(key)
        if isinstance(value, Mapping):
            source = value
            break
    if source is None:
        return {}
    result: dict[str, Any] = {}
    for key in _CHAPTER_CONTEXT_KEYS:
        value = source.get(key)
        safe = _safe_context_value(value)
        if safe is not None:
            result[key] = safe
    return result


def _safe_context_value(value: object) -> object | None:
    if isinstance(value, str):
        return _compact_text(value, limit=CHAPTER_TEXT_LIMIT)
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
    return _ordered_unique([value.strip() for value in values if isinstance(value, str) and value.strip()])


def _string_or_default(value: object, default: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else default
