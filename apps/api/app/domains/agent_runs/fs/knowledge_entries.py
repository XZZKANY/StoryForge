from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import PurePosixPath
from typing import Literal
from uuid import UUID

KnowledgeStatus = Literal["active", "superseded", "retired", "disputed"]
KnowledgeKind = Literal[
    "character_fact",
    "world_rule",
    "timeline_fact",
    "promise",
    "plan",
    "writing_rule",
    "reference",
]
KnowledgeEvidenceState = Literal["current", "stale"]
KnowledgeSourceType = Literal["project_file", "author_statement", "external_reference"]

_START_MARKER = "<!-- storyforge-knowledge:v1\n"
_METADATA_END = "\n-->\n"
_END_MARKER = "\n<!-- /storyforge-knowledge -->"
_KNOWLEDGE_STATUSES = frozenset({"active", "superseded", "retired", "disputed"})
_KNOWLEDGE_KINDS = frozenset(
    {"character_fact", "world_rule", "timeline_fact", "promise", "plan", "writing_rule", "reference"}
)
_EVIDENCE_STATES = frozenset({"current", "stale"})
_HASH_PATTERN = re.compile(r"sha256:[0-9a-f]{64}\Z")


class KnowledgeEntryError(ValueError):
    """A structured knowledge block violates the author-file contract."""


@dataclass(frozen=True)
class KnowledgeSource:
    type: KnowledgeSourceType
    path: str | None = None
    content_sha256: str | None = None
    agent_event_id: str | None = None
    locator: str | None = None
    title: str | None = None
    accessed_at: str | None = None
    summary_sha256: str | None = None


@dataclass(frozen=True)
class KnowledgeEntry:
    id: str
    status: KnowledgeStatus
    kind: KnowledgeKind
    evidence_state: KnowledgeEvidenceState
    title: str
    claim: str
    sources: tuple[KnowledgeSource, ...]
    claim_fingerprint: str
    created_at: str
    updated_at: str
    superseded_by: str | None = None


@dataclass(frozen=True)
class KnowledgeParseResult:
    entries: tuple[KnowledgeEntry, ...]
    warnings: tuple[str, ...]


def knowledge_claim_fingerprint(title: str, claim: str) -> str:
    normalized = "\n".join((_normalize_claim_text(title), _normalize_claim_text(claim)))
    return f"sha256:{hashlib.sha256(normalized.encode('utf-8')).hexdigest()}"


def render_knowledge_entry(entry: KnowledgeEntry) -> str:
    _validate_entry(entry)
    metadata: dict[str, object] = {
        "claim_fingerprint": entry.claim_fingerprint,
        "created_at": entry.created_at,
        "evidence_state": entry.evidence_state,
        "id": entry.id,
        "kind": entry.kind,
        "sources": [_source_payload(source) for source in entry.sources],
        "status": entry.status,
        "updated_at": entry.updated_at,
    }
    if entry.superseded_by is not None:
        metadata["superseded_by"] = entry.superseded_by
    encoded = json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return (
        f"{_START_MARKER}{encoded}{_METADATA_END}"
        f"## {entry.title.strip()}\n\n{entry.claim.strip()}"
        f"{_END_MARKER}\n"
    )


def parse_knowledge_markdown(content: str) -> KnowledgeParseResult:
    entries: list[KnowledgeEntry] = []
    warnings: list[str] = []
    cursor = 0
    block_number = 0
    while True:
        start = content.find(_START_MARKER, cursor)
        if start < 0:
            break
        block_number += 1
        metadata_start = start + len(_START_MARKER)
        metadata_end = content.find(_METADATA_END, metadata_start)
        next_start = content.find(_START_MARKER, metadata_start)
        if next_start >= 0 and (metadata_end < 0 or next_start < metadata_end):
            warnings.append(f"knowledge block {block_number}: metadata marker is not closed")
            cursor = next_start
            continue
        if metadata_end < 0:
            warnings.append(f"knowledge block {block_number}: metadata marker is not closed")
            break
        body_start = metadata_end + len(_METADATA_END)
        block_end = content.find(_END_MARKER, body_start)
        next_start = content.find(_START_MARKER, body_start)
        if next_start >= 0 and (block_end < 0 or next_start < block_end):
            warnings.append(f"knowledge block {block_number}: block marker is not closed")
            cursor = next_start
            continue
        if block_end < 0:
            warnings.append(f"knowledge block {block_number}: block marker is not closed")
            cursor = body_start
            continue
        try:
            raw_metadata = json.loads(content[metadata_start:metadata_end])
            if not isinstance(raw_metadata, dict):
                raise KnowledgeEntryError("metadata must be a JSON object")
            entry = _entry_from_payload(raw_metadata, content[body_start:block_end])
            if any(existing.id == entry.id for existing in entries):
                raise KnowledgeEntryError(f"duplicate knowledge id: {entry.id}")
            entries.append(entry)
        except (json.JSONDecodeError, KnowledgeEntryError) as exc:
            warnings.append(f"knowledge block {block_number}: {exc}")
        cursor = block_end + len(_END_MARKER)
    return KnowledgeParseResult(entries=tuple(entries), warnings=tuple(warnings))


def upsert_knowledge_entry(content: str, entry: KnowledgeEntry) -> str:
    rendered = render_knowledge_entry(entry)
    parsed = parse_knowledge_markdown(content)
    if parsed.warnings:
        raise KnowledgeEntryError("existing Markdown contains malformed knowledge blocks")
    if any(existing.id == entry.id for existing in parsed.entries):
        start, end = _entry_block_span(content, entry.id)
        return f"{content[:start]}{rendered}{content[end:]}"
    if not content:
        return rendered
    separator = "\n" if content.endswith("\n") else "\n\n"
    return f"{content}{separator}{rendered}"


def _entry_block_span(content: str, entry_id: str) -> tuple[int, int]:
    cursor = 0
    while True:
        start = content.find(_START_MARKER, cursor)
        if start < 0:
            break
        metadata_start = start + len(_START_MARKER)
        metadata_end = content.find(_METADATA_END, metadata_start)
        body_start = metadata_end + len(_METADATA_END)
        block_end = content.find(_END_MARKER, body_start)
        metadata = json.loads(content[metadata_start:metadata_end])
        end = block_end + len(_END_MARKER)
        if end < len(content) and content[end] == "\n":
            end += 1
        if isinstance(metadata, dict) and metadata.get("id") == entry_id:
            return start, end
        cursor = end
    raise KnowledgeEntryError(f"knowledge entry not found: {entry_id}")


def _entry_from_payload(payload: dict[str, object], body: str) -> KnowledgeEntry:
    title, claim = _parse_body(body)
    raw_sources = payload.get("sources")
    if not isinstance(raw_sources, list):
        raise KnowledgeEntryError("sources must be an array")
    entry = KnowledgeEntry(
        id=_required_text(payload, "id"),
        status=_required_text(payload, "status"),  # type: ignore[arg-type]
        kind=_required_text(payload, "kind"),  # type: ignore[arg-type]
        evidence_state=_required_text(payload, "evidence_state"),  # type: ignore[arg-type]
        title=title,
        claim=claim,
        sources=tuple(_source_from_payload(item) for item in raw_sources),
        claim_fingerprint=_required_text(payload, "claim_fingerprint"),
        created_at=_required_text(payload, "created_at"),
        updated_at=_required_text(payload, "updated_at"),
        superseded_by=_optional_text(payload.get("superseded_by")),
    )
    _validate_entry(entry)
    return entry


def _parse_body(body: str) -> tuple[str, str]:
    normalized = body.strip()
    first_line, separator, remainder = normalized.partition("\n")
    if not first_line.startswith("## ") or not separator:
        raise KnowledgeEntryError("body must start with a level-2 Markdown heading")
    title = first_line[3:].strip()
    claim = remainder.strip()
    if not title or not claim:
        raise KnowledgeEntryError("title and claim must not be empty")
    return title, claim


def _source_from_payload(value: object) -> KnowledgeSource:
    if not isinstance(value, dict):
        raise KnowledgeEntryError("source must be a JSON object")
    return KnowledgeSource(
        type=_required_text(value, "type"),  # type: ignore[arg-type]
        path=_optional_text(value.get("path")),
        content_sha256=_optional_text(value.get("content_sha256")),
        agent_event_id=_optional_text(value.get("agent_event_id")),
        locator=_optional_text(value.get("locator")),
        title=_optional_text(value.get("title")),
        accessed_at=_optional_text(value.get("accessed_at")),
        summary_sha256=_optional_text(value.get("summary_sha256")),
    )


def _source_payload(source: KnowledgeSource) -> dict[str, str]:
    payload = {"type": source.type}
    for key in (
        "path",
        "content_sha256",
        "agent_event_id",
        "locator",
        "title",
        "accessed_at",
        "summary_sha256",
    ):
        value = getattr(source, key)
        if value is not None:
            payload[key] = value
    return payload


def _validate_entry(entry: KnowledgeEntry) -> None:
    _validate_knowledge_id(entry.id, "id")
    if entry.status not in _KNOWLEDGE_STATUSES:
        raise KnowledgeEntryError(f"unknown status: {entry.status}")
    if entry.kind not in _KNOWLEDGE_KINDS:
        raise KnowledgeEntryError(f"unknown kind: {entry.kind}")
    if entry.evidence_state not in _EVIDENCE_STATES:
        raise KnowledgeEntryError(f"unknown evidence_state: {entry.evidence_state}")
    if not entry.title.strip() or not entry.claim.strip():
        raise KnowledgeEntryError("title and claim must not be empty")
    created_at = _parse_utc_timestamp(entry.created_at, "created_at")
    updated_at = _parse_utc_timestamp(entry.updated_at, "updated_at")
    if updated_at < created_at:
        raise KnowledgeEntryError("updated_at must not be earlier than created_at")
    expected_fingerprint = knowledge_claim_fingerprint(entry.title, entry.claim)
    if entry.claim_fingerprint != expected_fingerprint:
        raise KnowledgeEntryError("claim_fingerprint does not match title and claim")
    if not entry.sources:
        raise KnowledgeEntryError("at least one source is required")
    for source in entry.sources:
        _validate_source(source)
    if (entry.status == "superseded") != (entry.superseded_by is not None):
        raise KnowledgeEntryError("superseded status and superseded_by must be set together")
    if entry.superseded_by is not None:
        _validate_knowledge_id(entry.superseded_by, "superseded_by")
        if entry.superseded_by == entry.id:
            raise KnowledgeEntryError("superseded_by must reference another knowledge id")


def _validate_source(source: KnowledgeSource) -> None:
    if source.type == "project_file":
        _reject_unexpected_source_fields(
            source,
            allowed=frozenset({"path", "content_sha256"}),
        )
        if not source.path or not source.content_sha256:
            raise KnowledgeEntryError("project_file source requires path and content_sha256")
        _validate_relative_path(source.path)
        _validate_hash(source.content_sha256, "content_sha256")
        return
    if source.type == "author_statement":
        _reject_unexpected_source_fields(source, allowed=frozenset({"agent_event_id"}))
        if not source.agent_event_id:
            raise KnowledgeEntryError("author_statement source requires agent_event_id")
        return
    if source.type == "external_reference":
        _reject_unexpected_source_fields(
            source,
            allowed=frozenset({"locator", "title", "accessed_at", "summary_sha256"}),
        )
        if not all((source.locator, source.title, source.accessed_at, source.summary_sha256)):
            raise KnowledgeEntryError(
                "external_reference source requires locator, title, accessed_at, and summary_sha256"
            )
        _validate_hash(source.summary_sha256, "summary_sha256")
        return
    raise KnowledgeEntryError(f"unknown source type: {source.type}")


def _reject_unexpected_source_fields(source: KnowledgeSource, *, allowed: frozenset[str]) -> None:
    field_names = (
        "path",
        "content_sha256",
        "agent_event_id",
        "locator",
        "title",
        "accessed_at",
        "summary_sha256",
    )
    unexpected = [name for name in field_names if name not in allowed and getattr(source, name) is not None]
    if unexpected:
        raise KnowledgeEntryError(f"{source.type} source has unexpected fields: {', '.join(unexpected)}")


def _validate_knowledge_id(value: str, field: str) -> None:
    if not value.startswith("pk_"):
        raise KnowledgeEntryError(f"{field} must use pk_<uuid>")
    try:
        parsed = UUID(value[3:])
    except ValueError as exc:
        raise KnowledgeEntryError(f"{field} must use pk_<uuid>") from exc
    if str(parsed) != value[3:]:
        raise KnowledgeEntryError(f"{field} must use a canonical lowercase UUID")


def _validate_hash(value: str, field: str) -> None:
    if not is_knowledge_sha256(value):
        raise KnowledgeEntryError(f"{field} must use sha256:<64 lowercase hex>")


def is_knowledge_sha256(value: object) -> bool:
    return isinstance(value, str) and _HASH_PATTERN.fullmatch(value) is not None


def _parse_utc_timestamp(value: str, field: str) -> datetime:
    if "T" not in value or not value.endswith("Z"):
        raise KnowledgeEntryError(f"{field} must use UTC ISO-8601 ending in Z")
    try:
        parsed = datetime.fromisoformat(f"{value[:-1]}+00:00")
    except ValueError as exc:
        raise KnowledgeEntryError(f"{field} must use UTC ISO-8601 ending in Z") from exc
    if parsed.utcoffset() != timedelta(0):
        raise KnowledgeEntryError(f"{field} must use UTC ISO-8601 ending in Z")
    return parsed


def _validate_relative_path(value: str) -> None:
    if value != value.strip() or "\\" in value:
        raise KnowledgeEntryError("project_file path must be a normalized relative path")
    candidate = PurePosixPath(value)
    if (
        not value
        or candidate.is_absolute()
        or not candidate.parts
        or ":" in candidate.parts[0]
        or any(part in {"", ".", ".."} for part in candidate.parts)
    ):
        raise KnowledgeEntryError("project_file path must be a normalized relative path")


def _required_text(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise KnowledgeEntryError(f"{key} must be a non-empty string")
    return value


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise KnowledgeEntryError("optional text fields must be non-empty strings")
    return value


def _normalize_claim_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip()
    return " ".join(normalized.split())
