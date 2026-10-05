from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from os.path import normcase
from pathlib import Path
from typing import Any

from app.common.generation_sources import selection_sha256
from app.common.performance import measured
from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.agent_runs.fs import (
    CollectedOrdinaryContext,
    KnowledgeRetrievalResult,
    collect_ordinary_context,
    has_knowledge_block_marker,
    retrieve_project_knowledge,
)
from app.domains.agent_runs.llm_context_limits import PROMPT_EXCERPT_TEXT_LIMIT


@dataclass(frozen=True)
class CollectedProjectKnowledge:
    """显式采集结果：空值不等于尚未采集，不会触发读盘回退。"""

    result: KnowledgeRetrievalResult | None = None
    warnings: tuple[str, ...] = ()
    ordinary: CollectedOrdinaryContext | None = None
    recovery_json: str | None = None


def project_knowledge_recovery_receipt(
    result: KnowledgeRetrievalResult,
    *,
    query: str,
    pinned_paths: list[str] | tuple[str, ...],
    excluded_ids: list[str] | tuple[str, ...],
    requested_paths: list[str] | tuple[str, ...],
) -> dict[str, Any]:
    """Pure proof of the actual retrieval decision, not a new filesystem baseline.

    No claim, source excerpt, query or absolute project root is persisted. Inactive
    and irrelevant candidates are not dependencies of the delivered selection.
    """
    relevant_paths = {normcase(path) for path in requested_paths}
    relevant_paths.update(normcase(item.relative_path) for item in result.items)
    return redact_sensitive(
        {
            "version": "project-knowledge-selection-v1",
            "query_sha256": selection_sha256(query),
            "pinned_paths": list(pinned_paths),
            "excluded_ids": list(excluded_ids),
            "requested_paths": list(requested_paths),
            "selection_sha256": selection_sha256([asdict(item) for item in result.items]),
            "author_notes_sha256": selection_sha256(
                [(path, notes) for path, notes in result.plain_notes if normcase(path) in relevant_paths]
            ),
            "structured_admission_sha256": selection_sha256(
                [path for path in result.structured_paths if normcase(path) in relevant_paths]
            ),
        }
    )


@measured("context.collect")
def collect_project_knowledge_context(
    bundle: Mapping[str, Any] | None,
    *,
    context_files: list[dict[str, Any]],
    query: str,
) -> CollectedProjectKnowledge:
    project_root = _first_string(bundle, "project_root", "projectRoot")
    if project_root is None or project_root.startswith("storyforge://"):
        return CollectedProjectKnowledge()
    if not Path(project_root).is_dir():
        ordinary = collect_ordinary_context(project_root, context_files=context_files)
        return CollectedProjectKnowledge(ordinary=ordinary)
    pinned_paths = [
        str(item["relative_path"])
        for item in context_files
        if item.get("kind") == "knowledge" and isinstance(item.get("relative_path"), str)
    ]
    excluded_ids = _knowledge_exclusion_ids(bundle)
    try:
        retrieved = retrieve_project_knowledge(
            project_root,
            query=query,
            pinned_paths=pinned_paths,
            excluded_ids=excluded_ids,
        )
    except (OSError, ValueError):
        ordinary = collect_ordinary_context(project_root, context_files=context_files)
        return CollectedProjectKnowledge(warnings=("structured Project Knowledge retrieval failed",), ordinary=ordinary)
    ordinary = collect_ordinary_context(
        project_root, context_files=context_files, structured_paths=retrieved.structured_paths
    )
    receipt = project_knowledge_recovery_receipt(
        retrieved,
        query=query,
        pinned_paths=pinned_paths,
        excluded_ids=excluded_ids,
        requested_paths=[item["relative_path"] for item in context_files],
    )
    return CollectedProjectKnowledge(
        result=retrieved, ordinary=ordinary, recovery_json=json.dumps(receipt, ensure_ascii=False, sort_keys=True)
    )


def merge_project_knowledge_entries(
    knowledge: CollectedProjectKnowledge,
    *,
    context_files: list[dict[str, Any]],
    max_context_files: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    """纯值合并：结构化知识保留检索预算，排除对应 raw 文件；混合文件保留块外说明。"""
    retrieved = knowledge.result
    structured_paths = {normcase(path) for path in retrieved.structured_paths} if retrieved is not None else set()
    selected_paths = {normcase(str(item.get("relative_path") or "")) for item in context_files}
    warnings = list(knowledge.warnings)
    if knowledge.ordinary is not None:
        context_files = [item.as_context_file() for item in knowledge.ordinary.files]
        warnings.extend(knowledge.ordinary.warnings)
    result: list[dict[str, Any]] = []
    for item in context_files:
        excerpt = item.get("excerpt")
        marked = isinstance(excerpt, str) and has_knowledge_block_marker(excerpt)
        # Admission belongs to the current source, not to the caller's semantic kind.
        # Unverified/truncated blocks must not become ordinary notes when collection
        # is unavailable. Pure replay does not retry I/O to resolve that uncertainty.
        if normcase(str(item.get("relative_path") or "")) in structured_paths or marked:
            if marked:
                warnings.append(f"raw structured context omitted by admission: {item.get('relative_path')}")
            continue
        result.append(item)
    if retrieved is None:
        return result, warnings
    selected_paths.update(normcase(item.relative_path) for item in retrieved.items)
    for item in retrieved.items:
        if item.selection_source == "auto_retrieved" and len(result) >= max_context_files:
            break
        redacted_excerpt = redact_sensitive_text(item.excerpt)
        result.append(
            {
                "relative_path": item.relative_path,
                "kind": "knowledge",
                "title": item.entry.title,
                # Retrieval already budgeted structured entries. Do not crop their tail
                # a second time to the ordinary-file excerpt limit.
                "excerpt": redacted_excerpt[:PROMPT_EXCERPT_TEXT_LIMIT],
                "excerpt_chars": len(redacted_excerpt),
                "truncated": len(redacted_excerpt) > PROMPT_EXCERPT_TEXT_LIMIT,
                "knowledge_id": item.entry.id,
                "selection_source": item.selection_source,
                "evidence_state": item.evidence_state,
                "warning_count": item.warning_count,
            }
        )
    warnings.extend(retrieved.warnings)
    # C06：混合文件（合法 active 块 + 块外普通说明）保留说明部分，并提示作者。
    for path, notes in retrieved.plain_notes:
        if normcase(path) not in selected_paths:
            continue
        if len(result) >= max_context_files:
            warnings.append("knowledge author notes truncated by count limit")
            break
        redacted_notes = redact_sensitive_text(notes)
        result.append(
            {
                "relative_path": path,
                "kind": "materials",
                "title": f"{path}（块外说明）",
                "excerpt": redacted_notes[:PROMPT_EXCERPT_TEXT_LIMIT],
                "excerpt_chars": len(redacted_notes),
                "truncated": len(redacted_notes) > PROMPT_EXCERPT_TEXT_LIMIT,
            }
        )
        warnings.append(f"knowledge file has non-structured author notes: {path}")
    if any(item.get("truncated") for item in result):
        warnings.append("context excerpts truncated by delivery budget")
    return result, warnings


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
