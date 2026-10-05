from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from os.path import normcase
from typing import Any

from app.common.performance import measured
from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.agent_runs._text import compact_text
from app.domains.agent_runs.context_channel_requests import context_channel_requests, review_channel_source
from app.domains.agent_runs.context_provenance import (
    llm_context_snapshot_trace_summary as llm_context_snapshot_trace_summary,
)
from app.domains.agent_runs.context_provenance import snapshot_run_state as _run_state
from app.domains.agent_runs.context_provenance import with_snapshot_id as _with_snapshot_id
from app.domains.agent_runs.fs import FsToolError, normalize_project_relative_path, source_delivery_manifest
from app.domains.agent_runs.knowledge_context import (
    CollectedProjectKnowledge,
    collect_project_knowledge_context,
    merge_project_knowledge_entries,
)
from app.domains.agent_runs.llm_context_limits import (
    CONTEXT_FILE_TEXT_LIMIT,
    MAX_CONTEXT_FILES,
    MAX_REVIEW_ISSUES,
    MAX_STORY_MEMORY_ITEMS,
    MEMORY_TEXT_LIMIT,
    REVIEW_TEXT_LIMIT,
    SELECTED_FILE_TEXT_LIMIT,
    SNAPSHOT_VERSION,
)
from app.domains.agent_runs.llm_prompt_context import (
    llm_context_snapshot_to_prompt_context_bundle as llm_context_snapshot_to_prompt_context_bundle,
)
from app.domains.agent_runs.llm_prompt_context import synthetic_context_delivery
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
    normalized_relative_context_path as _normalized_relative_context_path,
)
from app.domains.agent_runs.loop.context_values import (
    omitted_summary as _omitted_summary,
)
from app.domains.agent_runs.loop.context_values import (
    safe_context_value as _safe_context_value,
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
    extra_context_files: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """兼容 live 入口：此时采集项目知识，再交给确定性快照组装。"""
    artifact_items = list(artifacts) if artifacts is not None else None
    event_items = list(event_history) if event_history is not None else None
    extra_files = list(extra_context_files) if extra_context_files is not None else None
    bundle = context_bundle if isinstance(context_bundle, Mapping) else None
    context_files, _, _ = _context_files_with_loop_reads(bundle, file_path=file_path, extra_context_files=extra_files)
    knowledge = collect_project_knowledge_context(
        bundle, context_files=context_files, query=f"{user_message}\n{file_path}"
    )
    # 只在兼容层读取对象属性；纯入口负责一次白名单/文本归一化。
    run_values = (
        None
        if run_state is None
        else {key: _value(run_state, key) for key in ("public_id", "run_id", "goal", "status", "current_step")}
    )
    return build_llm_context_snapshot_from_collected(
        knowledge=knowledge,
        run_state=run_values,
        intent=intent,
        user_message=user_message,
        file_path=file_path,
        content=content,
        context_bundle=context_bundle,
        role_hints=role_hints,
        role_mentions=role_mentions,
        review_report=review_report,
        artifacts=artifact_items,
        event_history=event_items,
        extra_context_files=extra_files,
    )


@measured("context.select")
def build_llm_context_snapshot_from_collected(
    *,
    knowledge: CollectedProjectKnowledge,
    run_state: Mapping[str, Any] | None,
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
    extra_context_files: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """从已物化的上下文值组装快照；即使 knowledge 为空也不隐式采集。"""

    extra_files = list(extra_context_files) if extra_context_files is not None else None
    artifact_items = list(artifacts) if artifacts is not None else None
    event_items = list(event_history) if event_history is not None else None
    bundle = context_bundle if isinstance(context_bundle, Mapping) else None
    warnings: list[str] = []
    if context_bundle is not None and bundle is None:
        warnings.append("context_bundle ignored because it was not an object")

    context_files, file_warnings, unsafe_file_count = _context_files_with_loop_reads(
        bundle, file_path=file_path, extra_context_files=extra_files
    )
    warnings.extend(file_warnings)
    context_files, knowledge_warnings = merge_project_knowledge_entries(
        knowledge,
        context_files=context_files,
        max_context_files=MAX_CONTEXT_FILES,
    )
    warnings.extend(knowledge_warnings)
    review_source = review_channel_source(review_report, artifact_items)
    review_summary = _review_report_summary(redact_sensitive(review_source))
    safe_channels = redact_sensitive(bundle)
    story_memory = _story_memory_summary(safe_channels)
    chapter_context = _chapter_context_summary(safe_channels)
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

    requested_sources, _, _ = _context_files_with_loop_reads(
        bundle,
        file_path=file_path,
        extra_context_files=extra_files,
        max_files=64,
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
            "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest() if isinstance(content, str) else None,
            "content_excerpt": compact_text(content, limit=SELECTED_FILE_TEXT_LIMIT),
        },
        "role_hints": _string_list(role_hints),
        "role_mentions": _string_list(role_mentions),
        "project": project,
        "context_files": context_files,
        "source_manifest": source_delivery_manifest(knowledge.ordinary, context_files, requested=requested_sources),
        "knowledge_recovery": json.loads(knowledge.recovery_json) if knowledge.recovery_json else None,
        "channel_requests": context_channel_requests(bundle, review_source),
        "context_budget": {
            "truncated": bool(
                bundle and isinstance(bundle.get("budget"), Mapping) and bundle["budget"].get("truncated") is True
            )
            or any(item.get("truncated") is True for item in context_files)
            or any("truncated by" in warning for warning in warnings),
        },
        "review_report": review_summary,
        "story_memory": story_memory,
        "chapter_context": chapter_context,
        "included_sections": included_sections,
        "warnings": warnings,
        "omitted": omitted,
    }
    _, synthetic_refs = synthetic_context_delivery(snapshot)
    snapshot["source_manifest"].extend(synthetic_refs)
    snapshot["context_budget"]["truncated"] |= any(ref["truncated"] for ref in synthetic_refs)
    return _with_snapshot_id(snapshot)


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


def _context_files_with_loop_reads(
    bundle: Mapping[str, Any] | None,
    *,
    file_path: str,
    extra_context_files: Iterable[Mapping[str, Any]] | None,
    max_files: int = MAX_CONTEXT_FILES,
) -> tuple[list[dict[str, Any]], list[str], int]:
    files, warnings, unsafe_count = _context_files(bundle, file_path=file_path, max_files=max_files)
    if extra_context_files is None:
        return files, warnings, unsafe_count
    # Loop reads use the same path, redaction, selected-file and budget checks as
    # request context, before structured admission; never append after filtering.
    extra_items: list[dict[str, Any]] = []
    for item in extra_context_files:
        if not isinstance(item, Mapping) or not isinstance(item.get("excerpt"), str) or not item["excerpt"].strip():
            continue
        try:
            path = normalize_project_relative_path(str(item.get("relative_path") or ""))
        except FsToolError:
            warnings.append("loop read context ignored because its relative path was unsafe")
            continue
        extra_items.append({**item, "relative_path": path, "kind": "setting"})
    extra_bundle = {"files": extra_items}
    extra_files, extra_warnings, extra_unsafe = _context_files(extra_bundle, file_path=file_path, max_files=max_files)
    warnings.extend(extra_warnings)
    existing_paths = {normcase(item["relative_path"]) for item in files}
    for item in extra_files:
        if normcase(item["relative_path"]) in existing_paths:
            continue
        if len(files) >= max_files:
            warnings.append("loop read context files truncated by count limit")
            break
        item["selection_source"] = "loop_fs_read"
        files.append(item)
        existing_paths.add(normcase(item["relative_path"]))
    return files, warnings, unsafe_count + extra_unsafe


def _context_files(
    bundle: Mapping[str, Any] | None,
    *,
    file_path: str,
    max_files: int = MAX_CONTEXT_FILES,
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
        if not isinstance(item, Mapping):
            warnings.append("context_bundle.files item ignored because it was not an object")
            continue
        kind = _first_string(item, "kind") or "other"
        excerpt = _first_string(item, "excerpt") or ""
        if kind in _UNSAFE_FILE_KINDS or _looks_like_harness_payload(excerpt):
            unsafe_count += 1
            continue
        relative_path = _normalized_relative_context_path(_first_string(item, "relative_path", "relativePath", "path"))
        path = _first_string(item, "path")
        if _matches_selected_file(relative_path, selected_refs) or _matches_selected_file(path, selected_refs):
            continue
        if relative_path is None:
            warnings.append("context_bundle.files item ignored because its relative path was unsafe")
            continue
        if len(result) >= max_files:
            warnings.append("context_bundle files truncated by count limit")
            break
        title = _first_string(item, "title", "name")
        context_file: dict[str, Any] = {
            "relative_path": relative_path,
            "kind": kind,
            "title": title or relative_path,
        }
        if excerpt:
            redacted_excerpt = redact_sensitive_text(excerpt)
            if redacted_excerpt != excerpt:
                warnings.append(f"context_bundle file redacted: {relative_path}")
            context_file["excerpt"] = compact_text(redacted_excerpt, limit=CONTEXT_FILE_TEXT_LIMIT)
            context_file["excerpt_chars"] = len(redacted_excerpt)
            context_file["truncated"] = len(" ".join(redacted_excerpt.split())) > CONTEXT_FILE_TEXT_LIMIT
        result.append(context_file)
    return result, warnings, unsafe_count


def _review_report_summary(report: object | None) -> dict[str, Any] | None:
    if not isinstance(report, Mapping):
        return None
    issues = report.get("issues")
    safe_issues = (
        [_review_issue_summary(item) for item in issues[:MAX_REVIEW_ISSUES] if isinstance(item, Mapping)]
        if isinstance(issues, list)
        else []
    )
    suggested_actions = report.get("suggested_actions")
    safe_actions = (
        [
            compact_text(item, limit=REVIEW_TEXT_LIMIT)
            for item in suggested_actions[:MAX_REVIEW_ISSUES]
            if isinstance(item, str) and item.strip()
        ]
        if isinstance(suggested_actions, list)
        else []
    )
    summary: dict[str, Any] = {
        "kind": _first_string(report, "kind") or "review_report",
        "issue_count": len(issues) if isinstance(issues, list) else 0,
        "issues": safe_issues,
        "suggested_actions": safe_actions,
    }
    file_path = _first_string(report, "file_path", "filePath")
    mode = _first_string(report, "mode")
    for key in ("content_sha256", "report_id"):
        value = _first_string(report, key)
        if value is not None:
            summary[key] = value
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
        if len(text) > MEMORY_TEXT_LIMIT:
            result["text_truncated"] = True
        else:
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
