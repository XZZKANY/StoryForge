from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from copy import deepcopy
from typing import Any

from app.common.redaction import redact_sensitive_text
from app.domains.agent_runs.llm_context_limits import (
    MAX_PROMPT_CONTEXT_FILES,
    MAX_STORY_MEMORY_ITEMS,
    PROMPT_EXCERPT_TEXT_LIMIT,
)
from app.domains.agent_runs.loop.context_values import first_string as _first_string


def llm_context_snapshot_to_prompt_context_bundle(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Convert a snapshot back into the legacy context_bundle shape used by current prompts."""

    selected_file = snapshot.get("selected_file") if isinstance(snapshot.get("selected_file"), Mapping) else {}
    project = snapshot.get("project") if isinstance(snapshot.get("project"), Mapping) else {}
    context_files = snapshot.get("context_files") if isinstance(snapshot.get("context_files"), list) else []
    files = [_prompt_context_file(item) for item in context_files if isinstance(item, Mapping)]
    synthetic_files, _ = synthetic_context_delivery(snapshot)
    files.extend(synthetic_files)
    knowledge_entries = [item for item in context_files if isinstance(item, Mapping) and item.get("knowledge_id")]
    sources = snapshot.get("source_manifest") if isinstance(snapshot.get("source_manifest"), list) else []
    if knowledge_entries or sources:
        # Keep metadata outside the claim's 4000-char slot, so state labels cannot
        # themselves displace an author-pinned tail constraint.
        lines = [
            "来源状态：stale 表示支撑证据已漂移，请核实，不能当作已确认的当前约束；"
            "current 仅表示来源版本匹配，不表示事实已独立核验。",
            "普通来源以当前文件重新采集；omitted 不得作为当前约束；unverified 是未回读资料。",
            *(json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")) for item in sources),
            *(
                json.dumps(
                    {
                        key: item.get(key)
                        for key in (
                            "knowledge_id",
                            "relative_path",
                            "selection_source",
                            "evidence_state",
                            "warning_count",
                        )
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                for item in ([] if sources else knowledge_entries)
            ),
        ]
        sources_file = _synthetic_prompt_file(
            relative_path="Context Sources",
            kind="context_sources",
            title="Context Sources",
            excerpt="\n".join(lines),
        )
        if sources_file["_truncated"]:
            raise ValueError("LLM context source metadata exceeds delivery budget")
        files.append(sources_file)

    current_file = _first_string(project, "current_file") or _first_string(selected_file, "file_path") or "unknown"
    summary: dict[str, Any] = {}
    counts = project.get("counts")
    if isinstance(counts, Mapping):
        summary["counts"] = dict(counts)
    has_story_structure = project.get("has_story_structure")
    if isinstance(has_story_structure, bool):
        summary["hasStoryStructure"] = has_story_structure

    context_budget = snapshot.get("context_budget")
    truncated = (isinstance(context_budget, Mapping) and context_budget.get("truncated") is True) or any(
        item.get("truncated") is True for item in context_files if isinstance(item, Mapping)
    )
    # Pop every internal marker, even when an earlier flag is true.
    delivery_flags = [item.pop("_truncated", False) for item in files]
    truncated = truncated or any(delivery_flags)
    # Do not silently drop pinned entries to make a DTO pass.
    if len(files) > MAX_PROMPT_CONTEXT_FILES:
        raise ValueError("LLM context exceeds Assistant bundle file budget")
    return {
        "project_root": _first_string(project, "project_root") or "storyforge://llm-context",
        "current_file": current_file,
        "files": files,
        "summary": summary,
        "budget": {
            "file_count": len(files),
            "char_count": sum(len(str(item.get("excerpt") or "")) for item in files),
            "max_files": MAX_PROMPT_CONTEXT_FILES,
            "max_excerpt_chars": PROMPT_EXCERPT_TEXT_LIMIT,
            "truncated": truncated,
        },
    }


def _prompt_context_file(item: Mapping[str, Any]) -> dict[str, Any]:
    relative_path = _first_string(item, "relative_path") or "unknown"
    kind = _first_string(item, "kind") or "other"
    title = _first_string(item, "title") or relative_path
    excerpt = _first_string(item, "excerpt") or ""
    redacted = redact_sensitive_text(excerpt)
    return {
        "path": relative_path,
        "relative_path": relative_path,
        "kind": kind,
        "title": title,
        "excerpt": redacted[:PROMPT_EXCERPT_TEXT_LIMIT] or "无摘录。",
        "_truncated": len(redacted) > PROMPT_EXCERPT_TEXT_LIMIT,
    }


def _story_memory_prompt_file(story_memory: object) -> dict[str, Any] | None:
    if not isinstance(story_memory, Mapping):
        return None
    items = story_memory.get("items")
    if not isinstance(items, list) or not items:
        return None
    lines: list[str] = []
    selected_items = []
    for item in items[:MAX_STORY_MEMORY_ITEMS]:
        if not isinstance(item, Mapping) or item.get("text_truncated") is True:
            continue
        label_parts = [_first_string(item, "entity"), _first_string(item, "kind")]
        label = " / ".join(part for part in label_parts if part)
        text = _first_string(item, "text")
        if text is not None:
            line = f"- {label}: {text}" if label else f"- {text}"
            if len(redact_sensitive_text("\n".join([*lines, line]))) > PROMPT_EXCERPT_TEXT_LIMIT:
                break  # Preserve whole memory atoms, never a half claim at the boundary.
            lines.append(line)
            selected_items.append(item)
    if not lines:
        return None
    result = _synthetic_prompt_file(
        relative_path="Story Memory",
        kind="story_memory",
        title="Story Memory",
        excerpt="\n".join(lines),
    )
    result["_delivered_count"] = len(lines)
    result["_selected_items"] = selected_items
    return result


def _chapter_context_prompt_file(chapter_context: object) -> dict[str, Any] | None:
    if not isinstance(chapter_context, Mapping) or not chapter_context:
        return None
    lines = []
    selected_values = {}
    for key, value in chapter_context.items():
        if not isinstance(value, str | int | float | bool | list):
            continue
        line = f"- {key}: {value}"
        if len(redact_sensitive_text("\n".join([*lines, line]))) > PROMPT_EXCERPT_TEXT_LIMIT:
            break
        lines.append(line)
        selected_values[key] = value
    if not lines:
        return None
    result = _synthetic_prompt_file(
        relative_path="Chapter Context",
        kind="chapter_context",
        title="Chapter Context",
        excerpt="\n".join(lines),
    )
    result["_delivered_count"] = len(lines)
    result["_selected_values"] = selected_values
    return result


def _review_report_prompt_file(report: Mapping[str, Any]) -> dict[str, Any]:
    # Remove whole issues/actions rather than deliver a cut JSON object or a
    # partial evidence quote. Counts make the omitted part explicit to the writer.
    issues = list(report.get("issues") or [])
    actions = list(report.get("suggested_actions") or [])
    delivered = {**report, "issues": issues, "suggested_actions": actions}
    omitted = False
    while True:
        delivered["omitted_issue_count"] = max(int(report.get("issue_count") or len(issues)) - len(issues), 0)
        delivered["omitted_action_count"] = int(
            report.get("requested_action_count") or len(report.get("suggested_actions") or [])
        ) - len(actions)
        encoded = redact_sensitive_text(json.dumps(delivered, ensure_ascii=False, sort_keys=True))
        if len(encoded) <= PROMPT_EXCERPT_TEXT_LIMIT or not (issues or actions):
            break
        (actions if actions else issues).pop()
        omitted = True
    result = _synthetic_prompt_file(
        relative_path="Review Report",
        kind="review_report",
        title="Review Report",
        excerpt=encoded,
    )
    result["_truncated"] = result["_truncated"] or omitted or delivered["omitted_issue_count"] > 0
    result["_delivered_count"] = len(issues)
    result["_delivered_action_count"] = len(actions)
    return result


def synthetic_context_delivery(snapshot: Mapping[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """One final-budget projection owns both synthetic text and safe evidence.

    Injected values have no live manuscript version proof. Metadata never contains
    their source text. Legacy snapshots without request accounting remain readable.
    """
    requests = snapshot.get("channel_requests")
    requests = requests if isinstance(requests, Mapping) else {}
    report = snapshot.get("review_report")
    report_request = requests.get("review_report") or {}
    if isinstance(report, Mapping) and report:
        report = {
            **report,
            "issue_count": report_request.get("requested_count", report.get("issue_count", 0)),
            "requested_action_count": report_request.get(
                "requested_action_count", len(report.get("suggested_actions") or [])
            ),
        }
    projected = {
        "story_memory": _story_memory_prompt_file(snapshot.get("story_memory")),
        "chapter_context": _chapter_context_prompt_file(snapshot.get("chapter_context")),
        "review_report": _review_report_prompt_file(report) if isinstance(report, Mapping) and report else None,
    }
    files, refs = [], []
    for kind, file in projected.items():
        request = requests.get(kind) or {}
        if file is None and not request:
            continue
        fallback_count = len(snapshot.get("chapter_context") or {}) if kind == "chapter_context" else 0
        delivered_count = file.pop("_delivered_count", fallback_count) if file else 0
        # Old memory snapshots do not have selection accounting; count the actual lines.
        if file and kind == "story_memory" and not delivered_count:
            delivered_count = len(file["excerpt"].splitlines())
        if kind == "story_memory":
            memory = snapshot.get("story_memory")
            fallback_count = len(memory.get("items") or []) if isinstance(memory, Mapping) else delivered_count
        else:
            fallback_count = fallback_count if kind == "chapter_context" else delivered_count
        delivered_actions = file.pop("_delivered_action_count", 0) if file else 0
        requested_count = request.get(
            "requested_count",
            report.get("issue_count", delivered_count)
            if kind == "review_report" and isinstance(report, Mapping)
            else fallback_count,
        )
        requested_actions = request.get(
            "requested_action_count",
            report.get("requested_action_count", delivered_actions)
            if kind == "review_report" and isinstance(report, Mapping)
            else 0,
        )
        omitted = max(requested_count - delivered_count, 0)
        truncated = bool(
            request.get("selection_truncated")
            or omitted
            or requested_actions > delivered_actions
            or (file and file["_truncated"])
        )
        excerpt = file["excerpt"] if file else ""
        ref = {
            "relative_path": file["relative_path"]
            if file
            else {
                "story_memory": "Story Memory",
                "chapter_context": "Chapter Context",
                "review_report": "Review Report",
            }[kind],
            "purpose": kind,
            "selection_source": "supplied_channel",
            "source_state": "unverified",
            "supplied_value_sha256": request.get("supplied_value_sha256"),
            "excerpt_sha256": hashlib.sha256(excerpt.encode("utf-8")).hexdigest() if file else None,
            "delivered_chars": len(excerpt),
            "requested_count": requested_count,
            "delivered_count": delivered_count,
            "omitted_count": omitted,
            "disposition": "delivered" if file else "omitted",
            "truncated": truncated,
        }
        if kind == "review_report":
            ref.update(
                requested_action_count=requested_actions,
                delivered_action_count=delivered_actions,
                omitted_action_count=max(requested_actions - delivered_actions, 0),
            )
        if truncated or file is None:
            ref["omission_reason"] = "channel_selection_or_projection" if truncated else "empty_or_invalid_channel"
            ref["omission_reasons"] = [
                *request.get("selection_omission_reasons", []),
                *(["text_or_list_budget"] if request.get("selection_truncated") else []),
                *(["selection_or_projection"] if omitted or requested_actions > delivered_actions else []),
            ] or ["empty_or_invalid_channel"]
        refs.append(ref)
        if file:
            file["_truncated"] = truncated
            file.pop("_selected_items", None)
            file.pop("_selected_values", None)
            files.append(file)
    return files, refs


def synthetic_context_selected_values(snapshot: Mapping[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Value consumers (polish guards) cannot recover atoms omitted by delivery."""
    memory = _story_memory_prompt_file(snapshot.get("story_memory"))
    chapter = _chapter_context_prompt_file(snapshot.get("chapter_context"))
    return (
        deepcopy(memory["_selected_items"]) if memory else [],
        deepcopy(chapter["_selected_values"]) if chapter else {},
    )


def _synthetic_prompt_file(*, relative_path: str, kind: str, title: str, excerpt: str) -> dict[str, Any]:
    redacted = redact_sensitive_text(excerpt)
    return {
        "path": f"storyforge://llm-context/{kind}",
        "relative_path": relative_path,
        "kind": kind,
        "title": title,
        "excerpt": redacted[:PROMPT_EXCERPT_TEXT_LIMIT] or "无摘录。",
        "_truncated": len(redacted) > PROMPT_EXCERPT_TEXT_LIMIT,
    }
