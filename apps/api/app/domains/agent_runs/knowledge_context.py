from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.common.performance import measured
from app.common.redaction import redact_sensitive_text
from app.domains.agent_runs._text import compact_text
from app.domains.agent_runs.fs import KnowledgeRetrievalResult, retrieve_project_knowledge


@dataclass(frozen=True)
class CollectedProjectKnowledge:
    """显式采集结果：空值不等于尚未采集，不会触发读盘回退。"""

    result: KnowledgeRetrievalResult | None = None
    warnings: tuple[str, ...] = ()


@measured("context.collect")
def collect_project_knowledge_context(
    bundle: Mapping[str, Any] | None,
    *,
    context_files: list[dict[str, Any]],
    query: str,
) -> CollectedProjectKnowledge:
    project_root = _first_string(bundle, "project_root", "projectRoot")
    if project_root is None or not Path(project_root).is_dir():
        return CollectedProjectKnowledge()
    pinned_paths = [
        str(item["relative_path"])
        for item in context_files
        if item.get("kind") == "knowledge" and isinstance(item.get("relative_path"), str)
    ]
    try:
        retrieved = retrieve_project_knowledge(
            project_root,
            query=query,
            pinned_paths=pinned_paths,
            excluded_ids=_knowledge_exclusion_ids(bundle),
        )
    except (OSError, ValueError):
        return CollectedProjectKnowledge(warnings=("structured Project Knowledge retrieval failed",))
    return CollectedProjectKnowledge(result=retrieved)


def merge_project_knowledge_entries(
    knowledge: CollectedProjectKnowledge,
    *,
    context_files: list[dict[str, Any]],
    max_context_files: int,
    context_file_text_limit: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    """纯值合并，保留原脱敏/裁剪与结构化 raw 排除行为。"""
    retrieved = knowledge.result
    if retrieved is None:
        return context_files, list(knowledge.warnings)
    structured_paths = set(retrieved.structured_paths)
    result = [
        item
        for item in context_files
        if not (item.get("kind") == "knowledge" and item.get("relative_path") in structured_paths)
    ]
    for item in retrieved.items:
        if item.selection_source == "auto_retrieved" and len(result) >= max_context_files:
            break
        redacted_excerpt = redact_sensitive_text(item.excerpt)
        result.append(
            {
                "relative_path": item.relative_path,
                "kind": "knowledge",
                "title": item.entry.title,
                "excerpt": compact_text(redacted_excerpt, limit=context_file_text_limit),
                "excerpt_chars": len(redacted_excerpt),
                "knowledge_id": item.entry.id,
                "selection_source": item.selection_source,
                "evidence_state": item.evidence_state,
                "warning_count": item.warning_count,
            }
        )
    return result, [*knowledge.warnings, *retrieved.warnings]


def _knowledge_exclusion_ids(bundle: Mapping[str, Any]) -> list[str]:
    exclusions = bundle.get("knowledge_exclusions")
    if not isinstance(exclusions, Mapping):
        return []
    ids = exclusions.get("ids")
    if not isinstance(ids, list):
        return []
    return [item for item in ids if isinstance(item, str) and item.startswith("pk_") and len(item) <= 64][:8]


def _first_string(bundle: Mapping[str, Any] | None, *keys: str) -> str | None:
    if bundle is None:
        return None
    for key in keys:
        value = bundle.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None
