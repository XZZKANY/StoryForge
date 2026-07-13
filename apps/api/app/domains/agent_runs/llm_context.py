from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from typing import Any

from app.domains.agent_runs._text import compact_text
from app.domains.agent_runs.loop.context_values import (
    CHAPTER_CONTEXT_KEYS as _CHAPTER_CONTEXT_KEYS,
)
from app.domains.agent_runs.loop.context_values import (
    UNSAFE_FILE_KINDS as _UNSAFE_FILE_KINDS,
)
from app.domains.agent_runs.loop.context_values import (
    artifact_kind as _artifact_kind,
)
from app.domains.agent_runs.loop.context_values import (
    artifact_payload as _artifact_payload,
)
from app.domains.agent_runs.loop.context_values import (
    first_string as _first_string,
)
from app.domains.agent_runs.loop.context_values import (
    included_sections as _included_sections,
)
from app.domains.agent_runs.loop.context_values import (
    looks_like_harness_payload as _looks_like_harness_payload,
)
from app.domains.agent_runs.loop.context_values import (
    matches_selected_file as _matches_selected_file,
)
from app.domains.agent_runs.loop.context_values import (
    omitted_summary as _omitted_summary,
)
from app.domains.agent_runs.loop.context_values import (
    safe_context_value as _safe_context_value,
)
from app.domains.agent_runs.loop.context_values import (
    story_memory_count as _story_memory_count,
)
from app.domains.agent_runs.loop.context_values import (
    string_list as _string_list,
)
from app.domains.agent_runs.loop.context_values import (
    string_or_default as _string_or_default,
)
from app.domains.agent_runs.loop.context_values import (
    value as _value,
)

SNAPSHOT_VERSION = 1
SELECTED_FILE_TEXT_LIMIT = 12000
CONTEXT_FILE_TEXT_LIMIT = 2000
MEMORY_TEXT_LIMIT = 800
REVIEW_TEXT_LIMIT = 600
MAX_CONTEXT_FILES = 8
MAX_REVIEW_ISSUES = 12
MAX_STORY_MEMORY_ITEMS = 8



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
        "user_goal": compact_text(user_message, limit=2000),
        "selected_file": {
            "file_path": _string_or_default(file_path, "unknown"),
            "content_chars": len(content) if isinstance(content, str) else 0,
            "content_excerpt": compact_text(content, limit=SELECTED_FILE_TEXT_LIMIT),
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
        "excerpt": compact_text(excerpt, limit=CONTEXT_FILE_TEXT_LIMIT) or "无摘录。",
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
        "excerpt": compact_text(excerpt, limit=CONTEXT_FILE_TEXT_LIMIT) or "无摘录。",
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
        result["goal"] = compact_text(goal, limit=2000)
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
            context_file["excerpt"] = compact_text(excerpt, limit=CONTEXT_FILE_TEXT_LIMIT)
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
        compact_text(item, limit=REVIEW_TEXT_LIMIT)
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
            result[key] = compact_text(value, limit=REVIEW_TEXT_LIMIT)
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
        result["text"] = compact_text(text, limit=MEMORY_TEXT_LIMIT)
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
