"""Qualify actual ordinary writer reads, not raw caller descriptors or new baselines."""

from __future__ import annotations

import json
from pathlib import Path

from app.common.generation_sources import MAX_MANIFEST_BYTES, selection_sha256
from app.domains.agent_runs.fs import collect_ordinary_context


def ordinary_sources_unchanged(manifest: dict, root: Path) -> bool:
    receipt = manifest.get("context_delivery")
    if not isinstance(receipt, dict) or receipt.get("version") != "writer-context-v1":
        return False
    refs = receipt.get("source_manifest")
    if (
        not isinstance(refs, list)
        or len(json.dumps(refs, ensure_ascii=False).encode("utf-8")) > MAX_MANIFEST_BYTES
        or selection_sha256(refs) != receipt.get("source_manifest_sha256")
    ):
        return False  # Missing legacy evidence is not a proven empty source list.
    for ref in refs:
        if not isinstance(ref, dict):
            return False
        state, disposition = ref.get("source_state"), ref.get("disposition")
        if state == "current" and disposition == "delivered":
            expected_hash = ref.get("source_text_sha256")
            if not isinstance(expected_hash, str) or len(expected_hash) != 64:
                return False
        elif state == "unavailable" and disposition == "omitted":
            if ref.get("omission_reason") not in {"unavailable_or_ineligible", "unadmitted_source", "empty_source"}:
                return False
        else:
            # Structured admissions are qualified by knowledge_recovery. Supplied
            # channels and over-budget requests are not independent disk reads.
            if state not in {"structured", "unverified", "excluded_by_admission", "not_collected"}:
                return False
            continue
        path = ref.get("relative_path")
        if not isinstance(path, str) or not path or not isinstance(ref.get("purpose"), str):
            return False
        collected = collect_ordinary_context(
            str(root),
            context_files=[
                {"relative_path": path, "kind": ref["purpose"], "selection_source": ref.get("selection_source")}
            ],
        )
        if disposition == "delivered":
            if len(collected.files) != 1 or collected.files[0].source_text_sha256 != expected_hash:
                return False
        elif collected.omitted != ((path, ref["purpose"], ref.get("selection_source"), ref["omission_reason"]),):
            return False
    return True
