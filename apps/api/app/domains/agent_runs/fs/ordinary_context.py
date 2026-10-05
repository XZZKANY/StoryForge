"""Bounded live collection and pure delivery evidence for ordinary pins/read facts."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from os.path import normcase
from typing import Any

from app.common.redaction import redact_sensitive_text
from app.domains.agent_runs._text import compact_text
from app.domains.agent_runs.fs.knowledge_entries import has_knowledge_block_marker
from app.domains.agent_runs.fs.project_knowledge import read_project_context_file
from app.domains.agent_runs.fs_safety import FsToolError
from app.domains.agent_runs.llm_context_limits import CONTEXT_FILE_TEXT_LIMIT, PROMPT_EXCERPT_TEXT_LIMIT
from app.domains.agent_runs.loop.context_values import looks_like_harness_payload


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class OrdinaryContextFile:
    relative_path: str
    kind: str
    title: str
    excerpt: str
    source_text_sha256: str
    selection_source: str
    source_chars: int
    truncated: bool

    def as_context_file(self) -> dict[str, Any]:
        return {**asdict(self), "excerpt_chars": len(self.excerpt), "source_state": "current"}


@dataclass(frozen=True, slots=True)
class CollectedOrdinaryContext:
    files: tuple[OrdinaryContextFile, ...] = ()
    omitted: tuple[tuple[str, str, str, str], ...] = ()  # path, purpose, selection, reason
    warnings: tuple[str, ...] = ()


def collect_ordinary_context(
    project_root: str,
    *,
    context_files: list[dict[str, Any]],
    structured_paths: tuple[str, ...] = (),
) -> CollectedOrdinaryContext:
    files = []
    omitted = []
    warnings = []
    structured = {normcase(path) for path in structured_paths}
    for item in context_files:
        path = item["relative_path"]
        kind = item.get("kind") or "other"
        selection = item.get("selection_source") or "request_bundle"
        if normcase(path) in structured:
            omitted.append((path, kind, selection, "structured_admission"))
            continue
        try:
            read = read_project_context_file(project_root, path)
            raw = read["content"]
        except (FsToolError, OSError, ValueError):
            omitted.append((path, kind, selection, "unavailable_or_ineligible"))
            warnings.append(f"context source omitted: {path} (unavailable_or_ineligible)")
            continue
        if has_knowledge_block_marker(raw) or looks_like_harness_payload(raw):
            omitted.append((path, kind, selection, "unadmitted_source"))
            warnings.append(f"context source omitted: {path} (unadmitted_source)")
            continue
        redacted = redact_sensitive_text(raw)
        normalized = compact_text(redacted, limit=max(len(redacted), 1))
        old_excerpt = item.get("excerpt") or ""
        # Retain an intentional current span (including fs.read windows). When it
        # no longer exists, use only current text; never carry the obsolete claim.
        old_body = old_excerpt.removeprefix("……（本章前文略） ").removeprefix("……（本章前文略）\n")
        if old_body and old_body in normalized:
            excerpt = old_excerpt
        elif kind == "draft":
            excerpt = normalized[-CONTEXT_FILE_TEXT_LIMIT:]
        else:
            excerpt = normalized[:CONTEXT_FILE_TEXT_LIMIT]
        if not excerpt.strip():
            omitted.append((path, kind, selection, "empty_source"))
            warnings.append(f"context source omitted: {path} (empty_source)")
            continue
        if old_body and old_body not in normalized:
            warnings.append(f"context source refreshed: {path}")
        if redacted != raw:
            warnings.append(f"context source redacted: {path}")
        files.append(
            OrdinaryContextFile(
                path,
                kind,
                item.get("title") or path,
                excerpt,
                text_sha256(raw),
                selection,
                len(raw),
                len(normalized) > len(excerpt),
            )
        )
    return CollectedOrdinaryContext(tuple(files), tuple(omitted), tuple(warnings))


def source_delivery_manifest(
    collected: CollectedOrdinaryContext | None,
    context_files: list[dict[str, Any]],
    *,
    requested: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Describe final selected excerpts, not merely candidates read from disk."""
    refs = []
    for item in context_files:
        # Match the legacy prompt projection exactly, including its trimming,
        # final redaction/cap and empty-excerpt marker. Hash actual delivered text.
        excerpt = (
            redact_sensitive_text(str(item.get("excerpt") or "").strip())[:PROMPT_EXCERPT_TEXT_LIMIT] or "无摘录。"
        )
        refs.append(
            {
                "relative_path": item["relative_path"],
                "purpose": item.get("kind") or "other",
                "selection_source": item.get("selection_source") or "request_bundle",
                "source_state": item.get("source_state")
                or ("structured" if item.get("knowledge_id") else "unverified"),
                "source_text_sha256": item.get("source_text_sha256"),
                "excerpt_sha256": text_sha256(excerpt),
                "delivered_chars": len(excerpt),
                "disposition": "delivered",
                "truncated": bool(item.get("truncated")),
                **(
                    {
                        "knowledge_id": item["knowledge_id"],
                        "lifecycle": "active",
                        "evidence_state": item.get("evidence_state"),
                    }
                    if item.get("knowledge_id")
                    else {}
                ),
            }
        )
    if collected is not None:
        delivered_paths = {normcase(item["relative_path"]) for item in context_files}
        for path, purpose, selection, reason in collected.omitted:
            if normcase(path) in delivered_paths:
                continue  # Structured admission delivered an entry or author notes instead.
            refs.append(
                {
                    "relative_path": path,
                    "purpose": purpose,
                    "selection_source": selection,
                    "source_state": "excluded_by_admission" if reason == "structured_admission" else "unavailable",
                    "source_text_sha256": None,
                    "excerpt_sha256": None,
                    "delivered_chars": 0,
                    "disposition": "omitted",
                    "omission_reason": reason,
                }
            )
    represented = {normcase(item["relative_path"]) for item in refs}
    for item in requested or []:
        path = item["relative_path"]
        if normcase(path) not in represented:
            refs.append(
                {
                    "relative_path": path,
                    "purpose": item.get("kind") or "other",
                    "selection_source": item.get("selection_source") or "request_bundle",
                    "disposition": "omitted",
                    "source_state": "not_collected",
                    "source_text_sha256": None,
                    "excerpt_sha256": None,
                    "delivered_chars": 0,
                    "omission_reason": "selection_budget",
                }
            )
            represented.add(normcase(path))
    return refs
