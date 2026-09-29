from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

from app.domains.agent_runs._text import compact_text
from app.domains.agent_runs.loop.context_values import first_string as _first_string
from app.domains.agent_runs.loop.context_values import story_memory_count as _story_memory_count
from app.domains.agent_runs.loop.context_values import value as _value


def llm_context_snapshot_trace_summary(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    context_files = snapshot.get("context_files")
    context_file_items = context_files if isinstance(context_files, list) else []
    story_memory = snapshot.get("story_memory")
    chapter_context = snapshot.get("chapter_context")
    review_report = snapshot.get("review_report")
    included_sections = snapshot.get("included_sections")
    warnings = snapshot.get("warnings")
    knowledge_entries = [
        {
            "knowledge_id": item.get("knowledge_id"),
            "relative_path": item.get("relative_path"),
            "selection_source": item.get("selection_source"),
            "evidence_state": item.get("evidence_state"),
            "warning_count": item.get("warning_count", 0),
        }
        for item in context_file_items
        if isinstance(item, Mapping) and isinstance(item.get("knowledge_id"), str)
    ]
    return {
        "snapshot_id": snapshot.get("snapshot_id"),
        "section_count": len(included_sections) if isinstance(included_sections, list) else 0,
        "context_file_count": len(context_file_items),
        "context_files": [
            path
            for item in context_file_items
            if isinstance(item, Mapping)
            if (path := _first_string(item, "relative_path")) is not None
        ],
        "knowledge_entries": knowledge_entries,
        "story_memory_count": _story_memory_count(story_memory),
        "has_chapter_context": bool(chapter_context),
        "has_review_report": isinstance(review_report, Mapping) and bool(review_report),
        "warning_count": len(warnings) if isinstance(warnings, list) else 0,
    }


def with_snapshot_id(snapshot: dict[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    snapshot_id = f"llmctx-{hashlib.sha256(encoded.encode('utf-8')).hexdigest()[:16]}"
    return {**snapshot, "snapshot_id": snapshot_id}


def snapshot_run_state(run_state: object | None) -> dict[str, Any]:
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
