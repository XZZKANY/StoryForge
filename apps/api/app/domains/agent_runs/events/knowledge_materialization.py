from __future__ import annotations

import hashlib
from dataclasses import replace
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.event_types import KNOWLEDGE_PROPOSAL_MATERIALIZED
from app.domains.agent_runs.events.knowledge_inbox import (
    knowledge_proposal_states,
    validated_pending_knowledge_artifact,
)
from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeSource,
    load_project_knowledge_document,
    parse_knowledge_markdown,
    render_knowledge_entry,
    resolve_new_project_file,
    upsert_knowledge_entry,
    validate_project_knowledge_markdown_target,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent


def materialize_knowledge_proposal(
    session: Session,
    *,
    project_root: str,
    artifact_id: int,
    revision: int,
    proposal_id: str,
) -> dict[str, Any]:
    artifact, run, payload = validated_pending_knowledge_artifact(
        session,
        project_root=project_root,
        artifact_id=artifact_id,
        revision=revision,
    )
    proposals = payload.get("proposals")
    proposal = next(
        (
            item
            for item in proposals
            if isinstance(item, dict) and item.get("proposal_id") == proposal_id
        ),
        None,
    ) if isinstance(proposals, list) else None
    if proposal is None:
        raise ValueError("Knowledge proposal item 不存在。")
    proposal_state = knowledge_proposal_states(session).get((artifact.id, proposal_id))
    if proposal_state is not None:
        raise ValueError(f"Knowledge proposal item 已处于 {proposal_state} 状态。")

    relative_path, _source_type = validate_project_knowledge_markdown_target(str(proposal["target_path"]))
    operation = str(proposal.get("operation"))
    if operation == "create":
        file_path = resolve_new_project_file(project_root, relative_path)
        before = ""
    else:
        document = load_project_knowledge_document(project_root, relative_path)
        file_path = document.absolute_path
        before = document.content
    if operation == "conflict":
        raise ValueError("冲突提议必须先由作者裁决为 extend 或 supersede。")

    confirmation_event_id = str(proposal["author_confirmation_event_id"])
    proposed_entry = KnowledgeEntry(
        id=str(proposal["knowledge_id"]),
        status="active",
        kind=str(proposal["kind"]),  # type: ignore[arg-type]
        evidence_state="current",
        title=str(proposal["title"]),
        claim=str(proposal["claim"]),
        sources=tuple(
            _materialized_source(source, confirmation_event_id=confirmation_event_id)
            for source in proposal.get("sources", [])
            if isinstance(source, dict)
        ),
        claim_fingerprint=str(proposal["claim_fingerprint"]),
        created_at=str(payload["created_at"]),
        updated_at=str(payload["created_at"]),
    )
    after, materialized_entry = _compile_operation(
        before,
        proposed_entry,
        operation=operation,
        related_knowledge_ids=[str(item) for item in proposal.get("related_knowledge_ids", [])],
        updated_at=str(payload["created_at"]),
    )
    baseline_hash = f"sha256:{hashlib.sha256(before.encode('utf-8')).hexdigest()}"
    patch_seed = (
        f"{artifact.id}:{revision}:{proposal_id}:{baseline_hash}:"
        f"{hashlib.sha256(after.encode()).hexdigest()}"
    )
    patch_id = f"knowledge-patch-{hashlib.sha256(patch_seed.encode()).hexdigest()}"
    patch = {
        "id": patch_id,
        "artifact_id": artifact.id,
        "kind": "project_knowledge",
        "patch_class": "project_knowledge",
        "proposal_id": proposal_id,
        "proposal_revision": revision,
        "knowledge_id": materialized_entry.id,
        "author_confirmation_event_id": confirmation_event_id,
        "file_path": file_path,
        "relative_path": relative_path,
        "before": before,
        "after": after,
        "baseline_hash": baseline_hash,
        "requires_confirmation": True,
        "created_by_tool": "knowledge.propose",
    }
    _record_materialized_event(session, run=run, artifact=artifact, proposal=proposal, patch=patch)
    return patch


def _record_materialized_event(
    session: Session,
    *,
    run: AgentRun,
    artifact: AgentArtifact,
    proposal: dict[str, Any],
    patch: dict[str, Any],
) -> None:
    existing = session.scalar(
        select(AgentRunEvent)
        .where(
            AgentRunEvent.run_id == run.id,
            AgentRunEvent.event_type == KNOWLEDGE_PROPOSAL_MATERIALIZED,
        )
        .order_by(AgentRunEvent.id.desc())
    )
    existing_payload = existing.payload if existing is not None and isinstance(existing.payload, dict) else {}
    if existing_payload.get("patch_identity") == patch["id"]:
        return

    from app.domains.agent_runs.service_store import record_agent_event

    record_agent_event(
        session,
        run,
        event_type=KNOWLEDGE_PROPOSAL_MATERIALIZED,
        actor="knowledge-materializer",
        message="Project Knowledge 提议已生成强制确认 patch。",
        payload={
            "artifact_id": artifact.id,
            "revision": artifact.payload.get("revision"),
            "proposal_id": proposal["proposal_id"],
            "knowledge_id": proposal["knowledge_id"],
            "patch_identity": patch["id"],
            "baseline_hash": patch["baseline_hash"],
            "after_hash": f"sha256:{hashlib.sha256(str(patch['after']).encode()).hexdigest()}",
            "target_path": patch["relative_path"],
            "author_confirmation_event_id": patch["author_confirmation_event_id"],
        },
    )


def _materialized_source(payload: dict[str, Any], *, confirmation_event_id: str) -> KnowledgeSource:
    source_type = payload.get("type")
    if source_type == "project_file":
        return KnowledgeSource(
            type="project_file",
            path=str(payload.get("path")),
            content_sha256=str(payload.get("content_sha256")),
        )
    if source_type == "author_statement":
        return KnowledgeSource(type="author_statement", agent_event_id=confirmation_event_id)
    if source_type == "external_reference":
        return KnowledgeSource(
            type="external_reference",
            locator=str(payload.get("locator")),
            title=str(payload.get("title")),
            accessed_at=str(payload.get("accessed_at")),
            summary_sha256=str(payload.get("summary_sha256")),
        )
    raise ValueError(f"不支持的 knowledge source type：{source_type}")


def _compile_operation(
    before: str,
    proposed: KnowledgeEntry,
    *,
    operation: str,
    related_knowledge_ids: list[str],
    updated_at: str,
) -> tuple[str, KnowledgeEntry]:
    if operation in {"create", "migrate"}:
        after = render_knowledge_entry(proposed) if not before else upsert_knowledge_entry(before, proposed)
        return after, proposed
    parsed = parse_knowledge_markdown(before)
    if parsed.warnings:
        raise ValueError("Knowledge target 含损坏 block，不能 materialize。")
    existing_by_id = {entry.id: entry for entry in parsed.entries}
    related = [existing_by_id[item] for item in related_knowledge_ids if item in existing_by_id]
    if len(related) != len(related_knowledge_ids) or not related:
        raise ValueError("Knowledge proposal 关联的既有 entry 已不存在。")
    current = related[0]
    if operation == "extend":
        combined_sources = tuple(dict.fromkeys((*current.sources, *proposed.sources)))
        revised = KnowledgeEntry(
            id=current.id,
            status="active",
            kind=proposed.kind,
            evidence_state="current",
            title=proposed.title,
            claim=proposed.claim,
            sources=combined_sources,
            claim_fingerprint=proposed.claim_fingerprint,
            created_at=current.created_at,
            updated_at=updated_at,
        )
        return upsert_knowledge_entry(before, revised), revised
    if operation == "retire":
        retired = KnowledgeEntry(
            id=current.id,
            status="retired",
            kind=current.kind,
            evidence_state=current.evidence_state,
            title=current.title,
            claim=current.claim,
            sources=current.sources,
            claim_fingerprint=current.claim_fingerprint,
            created_at=current.created_at,
            updated_at=updated_at,
        )
        return upsert_knowledge_entry(before, retired), retired
    if operation == "dispute":
        disputed_current = KnowledgeEntry(
            id=current.id,
            status="disputed",
            kind=current.kind,
            evidence_state=current.evidence_state,
            title=current.title,
            claim=current.claim,
            sources=current.sources,
            claim_fingerprint=current.claim_fingerprint,
            created_at=current.created_at,
            updated_at=updated_at,
        )
        disputed_proposed = replace(proposed, status="disputed")
        with_current = upsert_knowledge_entry(before, disputed_current)
        return upsert_knowledge_entry(with_current, disputed_proposed), disputed_proposed
    if operation == "supersede":
        superseded = KnowledgeEntry(
            id=current.id,
            status="superseded",
            kind=current.kind,
            evidence_state=current.evidence_state,
            title=current.title,
            claim=current.claim,
            sources=current.sources,
            claim_fingerprint=current.claim_fingerprint,
            created_at=current.created_at,
            updated_at=updated_at,
            superseded_by=proposed.id,
        )
        with_history = upsert_knowledge_entry(before, superseded)
        return upsert_knowledge_entry(with_history, proposed), proposed
    raise ValueError(f"不支持的 Knowledge proposal operation：{operation}")
