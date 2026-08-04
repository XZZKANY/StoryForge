from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Literal

from app.domains.agent_runs.fs.knowledge_entries import KnowledgeEntry
from app.domains.agent_runs.fs.knowledge_proposals import project_file_evidence_hash
from app.domains.agent_runs.fs.project_knowledge import project_knowledge_entry_index

KnowledgeSelectionSource = Literal["author_pinned", "auto_retrieved"]

KNOWLEDGE_RETRIEVAL_MAX_ITEMS = 8
KNOWLEDGE_RETRIEVAL_MAX_CHARS = 4_000


@dataclass(frozen=True)
class RetrievedKnowledgeEntry:
    relative_path: str
    entry: KnowledgeEntry
    selection_source: KnowledgeSelectionSource
    excerpt: str
    score: int
    evidence_state: Literal["current", "stale"]
    warning_count: int


@dataclass(frozen=True)
class KnowledgeRetrievalResult:
    items: tuple[RetrievedKnowledgeEntry, ...]
    warnings: tuple[str, ...]
    total_chars: int
    structured_paths: tuple[str, ...]


def retrieve_project_knowledge(
    project_root: str,
    *,
    query: str,
    pinned_paths: list[str] | tuple[str, ...] = (),
    excluded_ids: list[str] | tuple[str, ...] = (),
    max_items: int = KNOWLEDGE_RETRIEVAL_MAX_ITEMS,
    max_chars: int = KNOWLEDGE_RETRIEVAL_MAX_CHARS,
) -> KnowledgeRetrievalResult:
    index = project_knowledge_entry_index(project_root)
    excluded_set = set(excluded_ids)
    active = [
        item
        for item in index.entries
        if item.entry.status == "active" and item.entry.id not in excluded_set
    ]
    pinned_set = {path.replace("\\", "/") for path in pinned_paths}
    pinned = [item for item in active if item.relative_path in pinned_set]
    query_terms = _ngrams(_normalize(query))
    ranked = sorted(
        (
            (_score(item.relative_path, item.entry, query_terms), item)
            for item in active
            if item.relative_path not in pinned_set
        ),
        key=lambda pair: (-pair[0], pair[1].relative_path, pair[1].entry.id),
    )
    warnings = list(index.warnings)
    result: list[RetrievedKnowledgeEntry] = []
    remaining_chars = max(max_chars, 0)

    for item in pinned:
        evidence_state = knowledge_entry_evidence_state(project_root, item.entry)
        if evidence_state == "stale":
            warnings.append(f"knowledge evidence stale: {item.relative_path}#{item.entry.id}")
        excerpt, remaining_chars, truncated = _bounded_excerpt(item.entry, remaining_chars)
        if truncated:
            warnings.append(f"pinned knowledge truncated by budget: {item.relative_path}#{item.entry.id}")
        result.append(
            RetrievedKnowledgeEntry(
                relative_path=item.relative_path,
                entry=item.entry,
                selection_source="author_pinned",
                excerpt=excerpt,
                score=0,
                evidence_state=evidence_state,
                warning_count=int(evidence_state == "stale") + int(truncated),
            )
        )

    available_slots = max(max_items - len(result), 0)
    for score, item in ranked:
        if available_slots <= 0 or remaining_chars <= 0 or score <= 0:
            break
        excerpt, remaining_chars, _truncated = _bounded_excerpt(item.entry, remaining_chars)
        if not excerpt:
            break
        evidence_state = knowledge_entry_evidence_state(project_root, item.entry)
        if evidence_state == "stale":
            warnings.append(f"knowledge evidence stale: {item.relative_path}#{item.entry.id}")
        result.append(
            RetrievedKnowledgeEntry(
                relative_path=item.relative_path,
                entry=item.entry,
                selection_source="auto_retrieved",
                excerpt=excerpt,
                score=score,
                evidence_state=evidence_state,
                warning_count=int(evidence_state == "stale"),
            )
        )
        available_slots -= 1

    return KnowledgeRetrievalResult(
        items=tuple(result),
        warnings=tuple(warnings),
        total_chars=sum(len(item.excerpt) for item in result),
        structured_paths=tuple(sorted({item.relative_path for item in index.entries})),
    )


def _bounded_excerpt(entry: KnowledgeEntry, remaining: int) -> tuple[str, int, bool]:
    text = f"## {entry.title}\n\n{entry.claim}".strip()
    excerpt = text[:remaining]
    return excerpt, max(remaining - len(excerpt), 0), len(excerpt) < len(text)


def _score(relative_path: str, entry: KnowledgeEntry, query_terms: set[str]) -> int:
    if not query_terms:
        return 0
    haystack = _normalize(f"{relative_path} {entry.kind} {entry.title} {entry.claim}")
    haystack_terms = _ngrams(haystack)
    overlap = len(query_terms & haystack_terms)
    title_bonus = sum(2 for term in query_terms if term and term in _normalize(entry.title))
    return overlap + title_bonus


def _normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _ngrams(value: str) -> set[str]:
    compact = "".join(character for character in value if not character.isspace())
    terms = {compact[index : index + 2] for index in range(max(len(compact) - 1, 0))}
    terms.update(part for part in value.split() if len(part) >= 2)
    return terms


def knowledge_entry_evidence_state(
    project_root: str,
    entry: KnowledgeEntry,
) -> Literal["current", "stale"]:
    if entry.evidence_state == "stale":
        return "stale"
    for source in entry.sources:
        if source.type != "project_file" or source.path is None or source.content_sha256 is None:
            continue
        try:
            current_hash = project_file_evidence_hash(project_root, source.path)
        except (OSError, ValueError):
            return "stale"
        if current_hash != source.content_sha256:
            return "stale"
    return "current"
