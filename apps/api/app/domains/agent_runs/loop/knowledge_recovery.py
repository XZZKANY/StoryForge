"""Replay actual knowledge selection through its existing bounded public owner."""

from __future__ import annotations

from pathlib import Path

from app.common.generation_sources import selection_sha256
from app.domains.agent_runs.fs import retrieve_project_knowledge
from app.domains.agent_runs.knowledge_context import project_knowledge_recovery_receipt
from app.domains.agent_runs.llm_context_limits import MAX_CONTEXT_FILES


def knowledge_sources_unchanged(manifest: dict, root: Path, *, user_message: str) -> bool:
    receipt = manifest.get("context_delivery")
    if not isinstance(receipt, dict) or receipt.get("version") != "writer-context-v1":
        return False  # A legacy/fabricated handoff is not proof of an empty selection.
    saved = receipt.get("knowledge")
    if not isinstance(saved, dict) or saved.get("version") != "project-knowledge-selection-v1":
        return False
    current_file = manifest["writing_context"]["current_file"]
    target = (root / current_file).resolve()
    target.relative_to(root)
    # Runtime queries use the relative trace path, direct Assistant queries the
    # supplied absolute target. A hash match is mandatory, never guess a new query.
    query = next(
        (
            value
            for path in (current_file, str(target))
            if selection_sha256(value := f"{user_message}\n{path}") == saved.get("query_sha256")
        ),
        None,
    )
    if query is None:
        return False
    for key, limit in (
        ("pinned_paths", MAX_CONTEXT_FILES),
        ("requested_paths", MAX_CONTEXT_FILES),
        ("excluded_ids", 8),
    ):
        values = saved.get(key)
        if not isinstance(values, list) or len(values) > limit or any(not isinstance(value, str) for value in values):
            return False
    result = retrieve_project_knowledge(
        str(root),
        query=query,
        pinned_paths=saved["pinned_paths"],
        excluded_ids=saved["excluded_ids"],
    )
    return saved == project_knowledge_recovery_receipt(
        result,
        query=query,
        pinned_paths=saved["pinned_paths"],
        excluded_ids=saved["excluded_ids"],
        requested_paths=saved["requested_paths"],
    )
