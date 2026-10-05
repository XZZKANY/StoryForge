"""Pure accounting of requested synthetic values before lossy selection."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from typing import Any

from app.common.redaction import redact_sensitive_text
from app.domains.agent_runs.llm_context_limits import MAX_STORY_MEMORY_ITEMS, MEMORY_TEXT_LIMIT, REVIEW_TEXT_LIMIT
from app.domains.agent_runs.loop.context_values import (
    CHAPTER_CONTEXT_KEYS,
    CHAPTER_TEXT_LIMIT,
    artifact_kind,
    artifact_payload,
    first_string,
)


def review_channel_source(report: object, artifacts: Iterable[object] | None) -> Mapping[str, Any] | None:
    if isinstance(report, Mapping):
        return report
    for artifact in artifacts or ():
        if artifact_kind(artifact) == "review_report" and (payload := artifact_payload(artifact)) is not None:
            return payload
    return None


def _digest(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=lambda _: None)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _clipped(value: object) -> bool:
    if isinstance(value, str):
        return len(redact_sensitive_text(value.strip())) > CHAPTER_TEXT_LIMIT
    if isinstance(value, list):
        return len(value) > 12 or any(_clipped(item) for item in value[:12])
    return False


def context_channel_requests(bundle: Mapping[str, Any] | None, report: Mapping[str, Any] | None) -> dict[str, Any]:
    """Hashes identify supplied values, never claim live file/version validation."""
    bundle = bundle or {}
    result = {}
    memory = next((bundle[key] for key in ("story_memory", "storyMemory", "memory", "memories") if key in bundle), None)
    items = memory if isinstance(memory, list) else None
    if isinstance(memory, Mapping):
        items = next((memory[key] for key in ("items", "atoms", "memories") if isinstance(memory.get(key), list)), None)
    if isinstance(items, list):
        result["story_memory"] = {
            "requested_count": len(items),
            "supplied_value_sha256": _digest(items),
            "selection_truncated": any(
                len(redact_sensitive_text(first_string(item, "fact", "content", "text", "summary") or ""))
                > MEMORY_TEXT_LIMIT
                for item in items
                if isinstance(item, Mapping)
            ),
            "selection_omission_reasons": ["item_budget"] if len(items) > MAX_STORY_MEMORY_ITEMS else [],
        }
    chapter = next(
        (
            bundle[key]
            for key in ("chapter_context", "chapterContext", "chapter", "scene_packet", "scenePacket")
            if isinstance(bundle.get(key), Mapping)
        ),
        None,
    )
    if isinstance(chapter, Mapping):
        supplied = {key: chapter[key] for key in CHAPTER_CONTEXT_KEYS if key in chapter}
        result["chapter_context"] = {
            "requested_count": len(supplied),
            "supplied_value_sha256": _digest(supplied),
            "selection_truncated": any(_clipped(value) for value in supplied.values()),
        }
    if report is not None:
        issues, actions = report.get("issues"), report.get("suggested_actions")
        result["review_report"] = {
            "requested_count": len(issues) if isinstance(issues, list) else 0,
            "requested_action_count": len(actions) if isinstance(actions, list) else 0,
            "supplied_value_sha256": _digest(report),
            "selection_truncated": any(
                len(redact_sensitive_text(str(item.get(key) or "").strip())) > REVIEW_TEXT_LIMIT
                for item in (issues if isinstance(issues, list) else [])
                if isinstance(item, Mapping)
                for key in ("message", "evidence", "suggested_action")
            )
            or any(
                len(redact_sensitive_text(item.strip())) > REVIEW_TEXT_LIMIT
                for item in (actions if isinstance(actions, list) else [])
                if isinstance(item, str)
            ),
        }
    return result
