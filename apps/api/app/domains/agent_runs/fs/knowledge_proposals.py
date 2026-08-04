from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from app.domains.agent_runs.fs.knowledge_entries import (
    is_knowledge_sha256,
    knowledge_claim_fingerprint,
)
from app.domains.agent_runs.fs.project_knowledge import (
    project_knowledge_source_type,
    validate_project_knowledge_markdown_target,
)
from app.domains.agent_runs.fs_tools import (
    FsToolError,
    fs_read,
    normalize_project_relative_path,
    resolve_project_file,
    resolve_project_root,
    resolve_scoped_path,
)

KNOWLEDGE_PROPOSAL_ARTIFACT_KIND = "knowledge_proposal"
KNOWLEDGE_PROPOSAL_SCHEMA_VERSION = 1
KNOWLEDGE_PROPOSAL_MAX_ITEMS = 5

_OPERATIONS = frozenset(
    {"create", "extend", "conflict", "dispute", "retire", "supersede", "migrate"}
)
_KINDS = frozenset(
    {"character_fact", "world_rule", "timeline_fact", "promise", "plan", "writing_rule", "reference"}
)
_CONFIDENCE = frozenset({"author_declared", "project_observed", "inferred", "external_reference"})


def project_fingerprint(project_root: str) -> str:
    root = resolve_project_root(project_root)
    canonical = root.as_posix()
    if os.name == "nt":
        canonical = canonical.casefold()
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def project_file_evidence_hash(project_root: str, path: str) -> str:
    root = resolve_project_root(project_root)
    relative = normalize_project_relative_path(path)
    if project_knowledge_source_type(relative) is not None:
        from app.domains.agent_runs.fs.project_knowledge import project_knowledge_read

        project_knowledge_read(str(root), relative, limit=1)
        target = resolve_scoped_path(root, relative)
    else:
        fs_read(str(root), relative, offset=0, limit=1)
        target = Path(resolve_project_file(str(root), relative))
    return _file_sha256(target)


def build_knowledge_proposal_group(project_root: str, payload: dict[str, Any]) -> dict[str, Any]:
    raw_proposals = payload.get("proposals")
    if not isinstance(raw_proposals, list) or not 1 <= len(raw_proposals) <= KNOWLEDGE_PROPOSAL_MAX_ITEMS:
        raise FsToolError("knowledge.propose 每组必须包含 1 到 5 条提议。")
    root = resolve_project_root(project_root)
    now = _utc_now()
    proposals = [
        _build_proposal(root, raw, now=now)
        for raw in raw_proposals
        if isinstance(raw, dict)
    ]
    if len(proposals) != len(raw_proposals):
        raise FsToolError("knowledge.propose 的每条提议都必须是对象。")
    fingerprints = [item["claim_fingerprint"] for item in proposals]
    if len(fingerprints) != len(set(fingerprints)):
        raise FsToolError("同一知识提议组不能包含等价内容。")
    return {
        "schema_version": KNOWLEDGE_PROPOSAL_SCHEMA_VERSION,
        "proposal_group_id": f"kpg_{uuid4()}",
        "revision": 1,
        "project_fingerprint": project_fingerprint(str(root)),
        "created_at": now,
        "proposals": proposals,
    }


def _build_proposal(root: Path, payload: dict[str, Any], *, now: str) -> dict[str, Any]:
    target_path, _source_type = validate_project_knowledge_markdown_target(_required_text(payload, "target_path"))
    operation = _enum_text(payload, "operation", _OPERATIONS)
    title = _required_text(payload, "title")
    claim = _required_text(payload, "claim")
    kind = _enum_text(payload, "kind", _KINDS)
    confidence = _enum_text(payload, "confidence", _CONFIDENCE)
    reason = _required_text(payload, "reason")
    raw_sources = payload.get("sources")
    if not isinstance(raw_sources, list) or not raw_sources:
        raise FsToolError("knowledge proposal 至少需要一个来源。")
    sources = [_resolve_source(root, source, now=now) for source in raw_sources]
    related_ids = _knowledge_ids(payload.get("related_knowledge_ids"))
    if operation in {"extend", "dispute", "retire"} and len(related_ids) != 1:
        raise FsToolError(f"{operation} 必须且只能关联一个既有 knowledge id。")
    if operation == "supersede" and not related_ids:
        raise FsToolError("supersede 必须关联被替代的 knowledge id。")
    knowledge_id = related_ids[0] if operation in {"extend", "retire"} else f"pk_{uuid4()}"
    return {
        "proposal_id": f"kpp_{uuid4()}",
        "knowledge_id": knowledge_id,
        "author_confirmation_event_id": f"ake_{uuid4()}",
        "target_path": target_path,
        "operation": operation,
        "title": title.strip(),
        "claim": claim.strip(),
        "kind": kind,
        "confidence": confidence,
        "sources": sources,
        "related_knowledge_ids": related_ids,
        "reason": reason.strip(),
        "claim_fingerprint": knowledge_claim_fingerprint(title, claim),
    }


def _resolve_source(root: Path, value: object, *, now: str) -> dict[str, str]:
    if not isinstance(value, dict):
        raise FsToolError("knowledge proposal source 必须是对象。")
    source_type = _required_text(value, "type")
    if source_type == "project_file":
        relative = normalize_project_relative_path(_required_text(value, "path"))
        return {
            "type": source_type,
            "path": relative,
            "content_sha256": project_file_evidence_hash(str(root), relative),
        }
    if source_type == "author_statement":
        return {"type": source_type}
    if source_type == "external_reference":
        locator = _required_text(value, "locator")
        title = _required_text(value, "title")
        summary = value.get("summary")
        summary_sha256 = value.get("summary_sha256")
        if isinstance(summary, str) and summary.strip():
            resolved_summary_sha256 = f"sha256:{hashlib.sha256(summary.encode()).hexdigest()}"
        elif is_knowledge_sha256(summary_sha256):
            resolved_summary_sha256 = summary_sha256
        else:
            raise FsToolError("external_reference source 需要 summary 或 summary_sha256。")
        return {
            "type": source_type,
            "locator": locator,
            "title": title,
            "accessed_at": now,
            "summary_sha256": resolved_summary_sha256,
        }
    raise FsToolError(f"不支持的 knowledge source type：{source_type}")


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _knowledge_ids(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise FsToolError("related_knowledge_ids 必须是数组。")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.startswith("pk_"):
            raise FsToolError("related_knowledge_ids 只能包含 pk_<uuid>。")
        try:
            parsed = UUID(item[3:])
        except ValueError as exc:
            raise FsToolError("related_knowledge_ids 只能包含 pk_<uuid>。") from exc
        if str(parsed) != item[3:]:
            raise FsToolError("related_knowledge_ids 必须使用规范小写 UUID。")
        if item not in result:
            result.append(item)
    return result


def _enum_text(payload: dict[str, Any], key: str, allowed: frozenset[str]) -> str:
    value = _required_text(payload, key)
    if value not in allowed:
        raise FsToolError(f"不支持的 {key}：{value}")
    return value


def _required_text(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise FsToolError(f"{key} 不能为空。")
    return value


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
