from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Literal

from app.domains.agent_runs.fs.knowledge_entries import KnowledgeEntry, KnowledgeEvidenceState
from app.domains.agent_runs.fs.knowledge_proposals import project_file_evidence_hash
from app.domains.agent_runs.fs.project_knowledge import ProjectKnowledgeEntryIndex, project_knowledge_entry_index

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
    # 结构化文件路径 → 块外普通说明（报告 §3 C06）。
    plain_notes: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class SelectedKnowledgeEntry:
    """尚未校验来源的选择计划，不能冒充可注入模型的 retrieval result。"""

    relative_path: str
    entry: KnowledgeEntry = field(repr=False)
    selection_source: KnowledgeSelectionSource
    excerpt: str = field(repr=False)
    score: int
    truncated: bool


@dataclass(frozen=True)
class KnowledgeSelection:
    items: tuple[SelectedKnowledgeEntry, ...]
    warnings: tuple[str, ...]
    structured_paths: tuple[str, ...]
    # 结构化文件路径 → 块外普通说明（报告 §3 C06）。
    plain_notes: tuple[tuple[str, str], ...] = ()


def retrieve_project_knowledge(
    project_root: str,
    *,
    query: str,
    pinned_paths: list[str] | tuple[str, ...] = (),
    excluded_ids: list[str] | tuple[str, ...] = (),
    max_items: int = KNOWLEDGE_RETRIEVAL_MAX_ITEMS,
    max_chars: int = KNOWLEDGE_RETRIEVAL_MAX_CHARS,
) -> KnowledgeRetrievalResult:
    """兼容 I/O 入口：安全采集索引，只校验实际入选项，不预读所有候选来源。"""
    index = project_knowledge_entry_index(project_root)
    selection = select_knowledge_entries(
        index,
        query=query,
        pinned_paths=pinned_paths,
        excluded_ids=excluded_ids,
        max_items=max_items,
        max_chars=max_chars,
    )
    states = tuple(knowledge_entry_evidence_state(project_root, item.entry) for item in selection.items)
    return materialize_knowledge_selection(selection, evidence_states=states)


def select_knowledge_entries(
    index: ProjectKnowledgeEntryIndex,
    *,
    query: str,
    pinned_paths: list[str] | tuple[str, ...] = (),
    excluded_ids: list[str] | tuple[str, ...] = (),
    max_items: int = KNOWLEDGE_RETRIEVAL_MAX_ITEMS,
    max_chars: int = KNOWLEDGE_RETRIEVAL_MAX_CHARS,
) -> KnowledgeSelection:
    """固定索引上的排序/预算策略；不接收项目根或会隐式读盘的 callback。"""
    excluded_set = set(excluded_ids)
    active = [item for item in index.entries if item.entry.status == "active" and item.entry.id not in excluded_set]
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
    result: list[SelectedKnowledgeEntry] = []
    remaining_chars = max(max_chars, 0)
    # Pin 保留索引顺序与超预算空摘录的现有语义，不套用 auto 的数量上限。
    for item in pinned:
        excerpt, remaining_chars, truncated = _bounded_excerpt(item.entry, remaining_chars)
        result.append(SelectedKnowledgeEntry(item.relative_path, item.entry, "author_pinned", excerpt, 0, truncated))
    available_slots = max(max_items - len(result), 0)
    for score, item in ranked:
        if available_slots <= 0 or remaining_chars <= 0 or score <= 0:
            break
        excerpt, remaining_chars, truncated = _bounded_excerpt(item.entry, remaining_chars)
        if not excerpt:
            break
        result.append(
            SelectedKnowledgeEntry(item.relative_path, item.entry, "auto_retrieved", excerpt, score, truncated)
        )
        available_slots -= 1
    return KnowledgeSelection(
        items=tuple(result),
        warnings=index.warnings,
        # 非 active / excluded / 全部损坏的结构化文件同样不能从 raw bundle 再次注入。
        # index.structured_paths 含零有效条目路径；旧调用方未提供时回退到 entries 推导。
        structured_paths=tuple(
            sorted(index.structured_paths or {item.relative_path for item in index.entries})
        ),
        plain_notes=index.plain_notes,
    )


def materialize_knowledge_selection(
    selection: KnowledgeSelection, *, evidence_states: tuple[KnowledgeEvidenceState, ...]
) -> KnowledgeRetrievalResult:
    """固定选择计划 + 同序采集的来源状态 → 可重放结果；缺失证据不伪造 current。"""
    if len(evidence_states) != len(selection.items) or any(
        state not in {"current", "stale"} for state in evidence_states
    ):
        raise ValueError("Knowledge selection requires one valid evidence state per selected entry")
    warnings = list(selection.warnings)
    result: list[RetrievedKnowledgeEntry] = []
    for item, state in zip(selection.items, evidence_states, strict=True):
        if state == "stale":
            warnings.append(f"knowledge evidence stale: {item.relative_path}#{item.entry.id}")
        pinned_truncated = item.selection_source == "author_pinned" and item.truncated
        if pinned_truncated:
            warnings.append(f"pinned knowledge truncated by budget: {item.relative_path}#{item.entry.id}")
        result.append(
            RetrievedKnowledgeEntry(
                relative_path=item.relative_path,
                entry=item.entry,
                selection_source=item.selection_source,
                excerpt=item.excerpt,
                score=item.score,
                evidence_state=state,
                warning_count=int(state == "stale") + int(pinned_truncated),
            )
        )
    return KnowledgeRetrievalResult(
        items=tuple(result),
        warnings=tuple(warnings),
        total_chars=sum(len(item.excerpt) for item in result),
        structured_paths=selection.structured_paths,
        plain_notes=selection.plain_notes,
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
