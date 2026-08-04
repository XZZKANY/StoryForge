from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.event_types import (
    KNOWLEDGE_PROPOSAL_INVALIDATED,
    KNOWLEDGE_PROPOSAL_MATERIALIZED,
    KNOWLEDGE_PROPOSAL_REJECTED,
    KNOWLEDGE_PROPOSAL_REVISED,
)
from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    knowledge_entry_evidence_state,
    project_knowledge_entry_index,
)
from app.domains.agent_runs.fs.knowledge_proposals import (
    KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
    build_knowledge_proposal_group,
    project_fingerprint,
)
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent


def query_knowledge_proposal_inbox(session: Session, project_root: str) -> dict[str, Any]:
    fingerprint = project_fingerprint(project_root)
    knowledge_index = project_knowledge_entry_index(project_root)
    entries_by_id = {
        indexed.entry.id: (indexed.relative_path, indexed.entry)
        for indexed in knowledge_index.entries
    }
    rows = session.execute(
        select(AgentArtifact, AgentRun)
        .join(AgentRun, AgentRun.id == AgentArtifact.run_id)
        .where(AgentArtifact.kind == KNOWLEDGE_PROPOSAL_ARTIFACT_KIND)
        .order_by(AgentArtifact.id.asc())
    ).all()
    artifact_states = _knowledge_artifact_states(session)
    proposal_states = knowledge_proposal_states(session)
    items: list[dict[str, Any]] = []
    for artifact, run in rows:
        payload = artifact.payload if isinstance(artifact.payload, dict) else {}
        if payload.get("project_fingerprint") != fingerprint:
            continue
        proposals = payload.get("proposals")
        if not isinstance(proposals, list):
            continue
        projected_proposals = []
        for item in proposals:
            if not isinstance(item, dict):
                continue
            related_ids = item.get("related_knowledge_ids")
            conflicts = [
                _conflict_entry(relative_path, entry)
                for knowledge_id in related_ids
                if isinstance(knowledge_id, str)
                if (existing := entries_by_id.get(knowledge_id)) is not None
                for relative_path, entry in [existing]
            ] if isinstance(related_ids, list) else []
            projected_proposals.append(
                {
                    **item,
                    "state": artifact_states.get(artifact.id)
                    or proposal_states.get((artifact.id, str(item.get("proposal_id"))))
                    or ("conflict" if item.get("operation") == "conflict" else "pending"),
                    "conflicts": conflicts if item.get("operation") == "conflict" else [],
                }
            )
        states = {item["state"] for item in projected_proposals}
        if "conflict" in states:
            state = "conflict"
        elif "stale" in states:
            state = "stale"
        elif "pending" in states:
            state = "pending"
        elif len(states) == 1:
            state = next(iter(states))
        else:
            state = "history"
        items.append(
            {
                "proposal_group_id": payload.get("proposal_group_id"),
                "artifact_id": artifact.id,
                "run_id": run.public_id,
                "revision": payload.get("revision", 1),
                "state": state,
                "created_at": payload.get("created_at"),
                "proposals": projected_proposals,
            }
        )
    pending_states = {"pending", "conflict", "stale"}
    return {
        "items": items,
        "pending_count": sum(
            1
            for item in items
            for proposal in item["proposals"]
            if proposal["state"] in pending_states
        ),
    }


def _conflict_entry(relative_path: str, entry: KnowledgeEntry) -> dict[str, Any]:
    return {
        "knowledge_id": entry.id,
        "relative_path": relative_path,
        "title": entry.title,
        "claim": entry.claim,
        "status": entry.status,
        "evidence_state": entry.evidence_state,
        "sources": [
            {
                key: value
                for key, value in {
                    "type": source.type,
                    "path": source.path,
                    "content_sha256": source.content_sha256,
                    "agent_event_id": source.agent_event_id,
                    "locator": source.locator,
                    "title": source.title,
                    "accessed_at": source.accessed_at,
                    "summary_sha256": source.summary_sha256,
                }.items()
                if value is not None
            }
            for source in entry.sources
        ],
    }


def revise_knowledge_proposal_group(
    session: Session,
    *,
    project_root: str,
    artifact_id: int,
    revision: int,
    proposals: list[dict[str, Any]],
) -> dict[str, Any]:
    artifact, run, payload = validated_pending_knowledge_artifact(
        session,
        project_root=project_root,
        artifact_id=artifact_id,
        revision=revision,
    )
    original_proposals = payload.get("proposals")
    if not isinstance(original_proposals, list) or len(original_proposals) != len(proposals):
        raise ValueError("Knowledge proposal 编辑项与当前 revision 不匹配。")
    proposal_states = knowledge_proposal_states(session)
    unresolved_pairs = [
        (original, edited)
        for original, edited in zip(original_proposals, proposals, strict=True)
        if isinstance(original, dict)
        and proposal_states.get((artifact.id, str(original.get("proposal_id"))))
        in {None, "conflict", "stale"}
    ]
    if not unresolved_pairs:
        raise ValueError("Knowledge proposal 没有可编辑的未决条目。")
    revised_payload = build_knowledge_proposal_group(
        project_root,
        {"proposals": [edited for _original, edited in unresolved_pairs]},
    )
    revised_payload["proposal_group_id"] = payload["proposal_group_id"]
    revised_payload["revision"] = revision + 1
    revised_payload["supersedes_artifact_id"] = artifact.id

    from app.domains.agent_runs.service_store import record_agent_artifact, record_agent_event

    revised = record_agent_artifact(
        session,
        run,
        kind=KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
        payload=revised_payload,
        requires_confirmation=False,
    )
    record_agent_event(
        session,
        run,
        event_type=KNOWLEDGE_PROPOSAL_INVALIDATED,
        actor="author",
        message="作者编辑了 Project Knowledge 提议，旧 revision 已失效。",
        payload={
            "artifact_id": artifact.id,
            "revision": revision,
            "superseded_by_artifact_id": revised.id,
            "proposal_ids": [
                str(original["proposal_id"])
                for original, _edited in unresolved_pairs
                if isinstance(original.get("proposal_id"), str)
            ],
        },
    )
    record_agent_event(
        session,
        run,
        event_type=KNOWLEDGE_PROPOSAL_REVISED,
        actor="author",
        message="作者更新了 Project Knowledge 提议。",
        payload={
            "artifact_id": revised.id,
            "revision": revision + 1,
            "supersedes_artifact_id": artifact.id,
        },
    )
    return query_knowledge_proposal_inbox(session, project_root)


def refresh_knowledge_evidence(session: Session, project_root: str) -> dict[str, Any]:
    fingerprint = project_fingerprint(project_root)
    index = project_knowledge_entry_index(project_root)
    entries_by_id = {item.entry.id: item.entry for item in index.entries}
    proposal_states = knowledge_proposal_states(session)
    rows = session.execute(
        select(AgentArtifact, AgentRun)
        .join(AgentRun, AgentRun.id == AgentArtifact.run_id)
        .where(AgentArtifact.kind == KNOWLEDGE_PROPOSAL_ARTIFACT_KIND)
        .order_by(AgentArtifact.id.asc())
    ).all()
    from app.domains.agent_runs.service_store import record_agent_event

    for artifact, run in rows:
        payload = artifact.payload if isinstance(artifact.payload, dict) else {}
        if payload.get("project_fingerprint") != fingerprint:
            continue
        proposals = payload.get("proposals")
        if not isinstance(proposals, list):
            continue
        for proposal in proposals:
            if not isinstance(proposal, dict):
                continue
            proposal_id = proposal.get("proposal_id")
            knowledge_id = proposal.get("knowledge_id")
            if not isinstance(proposal_id, str) or not isinstance(knowledge_id, str):
                continue
            if proposal_states.get((artifact.id, proposal_id)) != "accepted":
                continue
            entry = entries_by_id.get(knowledge_id)
            if entry is None or knowledge_entry_evidence_state(project_root, entry) != "stale":
                continue
            record_agent_event(
                session,
                run,
                event_type="knowledge_evidence_stale",
                actor="knowledge-evidence",
                message="Project Knowledge 来源证据已漂移，等待作者复核。",
                payload={
                    "artifact_id": artifact.id,
                    "revision": payload.get("revision"),
                    "proposal_id": proposal_id,
                    "knowledge_id": knowledge_id,
                    "target_path": proposal.get("target_path"),
                },
            )
            proposal_states[(artifact.id, proposal_id)] = "stale"
    return query_knowledge_proposal_inbox(session, project_root)


def validated_pending_knowledge_artifact(
    session: Session,
    *,
    project_root: str,
    artifact_id: int,
    revision: int,
) -> tuple[AgentArtifact, AgentRun, dict[str, Any]]:
    row = session.execute(
        select(AgentArtifact, AgentRun)
        .join(AgentRun, AgentRun.id == AgentArtifact.run_id)
        .where(AgentArtifact.id == artifact_id)
    ).first()
    if row is None:
        raise ValueError("Knowledge proposal 不存在。")
    artifact, run = row
    if artifact.kind != KNOWLEDGE_PROPOSAL_ARTIFACT_KIND:
        raise ValueError("Knowledge proposal 不存在。")
    payload = artifact.payload if isinstance(artifact.payload, dict) else {}
    if payload.get("project_fingerprint") != project_fingerprint(project_root):
        raise ValueError("Knowledge proposal 不属于当前项目。")
    if payload.get("revision") != revision:
        raise ValueError("Knowledge proposal revision 已失效，请刷新 Inbox。")
    state = _knowledge_artifact_states(session).get(artifact.id)
    if state is not None:
        raise ValueError(f"Knowledge proposal 已处于 {state} 状态。")
    return artifact, run, payload


def _knowledge_artifact_states(session: Session) -> dict[int, str]:
    events = session.scalars(
        select(AgentRunEvent)
        .where(AgentRunEvent.event_type == "knowledge_proposal_invalidated")
        .order_by(AgentRunEvent.id.asc())
    )
    states: dict[int, str] = {}
    for event in events:
        artifact_id = event.payload.get("artifact_id") if isinstance(event.payload, dict) else None
        proposal_ids = event.payload.get("proposal_ids") if isinstance(event.payload, dict) else None
        if isinstance(artifact_id, int) and not isinstance(proposal_ids, list):
            states[artifact_id] = "invalidated"
    return states


def resolve_knowledge_proposal(
    session: Session,
    *,
    project_root: str,
    artifact_id: int,
    revision: int,
    proposal_id: str,
    resolution: str,
    patch_identity: str | None = None,
    author_confirmation_event_id: str | None = None,
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
    states = knowledge_proposal_states(session)
    existing = states.get((artifact.id, proposal_id))
    if existing == resolution:
        return query_knowledge_proposal_inbox(session, project_root)
    if existing is not None:
        raise ValueError(f"Knowledge proposal item 已处于 {existing} 状态。")
    if resolution == "accepted":
        _validate_accepted_writeback(
            session,
            project_root=project_root,
            artifact=artifact,
            proposal=proposal,
            patch_identity=patch_identity,
            author_confirmation_event_id=author_confirmation_event_id,
        )
        event_type = "knowledge_proposal_accepted"
        message = "作者确认并写回了 Project Knowledge 提议。"
    elif resolution == "rejected":
        event_type = KNOWLEDGE_PROPOSAL_REJECTED
        message = "作者拒绝了 Project Knowledge 提议。"
    else:
        raise ValueError(f"不支持的 Knowledge proposal resolution：{resolution}")

    from app.domains.agent_runs.service_store import record_agent_event

    record_agent_event(
        session,
        run,
        event_type=event_type,
        actor="author",
        message=message,
        payload={
            "artifact_id": artifact.id,
            "revision": revision,
            "proposal_id": proposal_id,
            **({"patch_identity": patch_identity} if patch_identity else {}),
            **(
                {"author_confirmation_event_id": author_confirmation_event_id}
                if author_confirmation_event_id
                else {}
            ),
        },
    )
    return query_knowledge_proposal_inbox(session, project_root)


def knowledge_proposal_states(session: Session) -> dict[tuple[int, str], str]:
    events = session.scalars(
        select(AgentRunEvent)
        .where(
            AgentRunEvent.event_type.in_(
                {
                    "knowledge_proposal_accepted",
                    "knowledge_proposal_rejected",
                    "knowledge_evidence_stale",
                    "knowledge_proposal_invalidated",
                }
            )
        )
        .order_by(AgentRunEvent.id.asc())
    )
    event_state = {
        "knowledge_proposal_accepted": "accepted",
        "knowledge_proposal_rejected": "rejected",
        "knowledge_evidence_stale": "stale",
        "knowledge_proposal_invalidated": "invalidated",
    }
    states: dict[tuple[int, str], str] = {}
    for event in events:
        payload = event.payload if isinstance(event.payload, dict) else {}
        artifact_id = payload.get("artifact_id")
        proposal_id = payload.get("proposal_id")
        if isinstance(artifact_id, int) and isinstance(proposal_id, str):
            states[(artifact_id, proposal_id)] = event_state[event.event_type]
        proposal_ids = payload.get("proposal_ids")
        if event.event_type == "knowledge_proposal_invalidated" and isinstance(
            proposal_ids, list
        ):
            for item in proposal_ids:
                if isinstance(artifact_id, int) and isinstance(item, str):
                    states[(artifact_id, item)] = "invalidated"
    return states


def _validate_accepted_writeback(
    session: Session,
    *,
    project_root: str,
    artifact: AgentArtifact,
    proposal: dict[str, Any],
    patch_identity: str | None,
    author_confirmation_event_id: str | None,
) -> None:
    if not patch_identity or not author_confirmation_event_id:
        raise ValueError("accepted resolution 缺少 patch identity 或作者确认 event id。")
    materialized = session.scalar(
        select(AgentRunEvent)
        .where(
            AgentRunEvent.run_id == artifact.run_id,
            AgentRunEvent.event_type == KNOWLEDGE_PROPOSAL_MATERIALIZED,
        )
        .order_by(AgentRunEvent.id.desc())
    )
    materialized_payload = (
        materialized.payload if materialized is not None and isinstance(materialized.payload, dict) else {}
    )
    expected = {
        "artifact_id": artifact.id,
        "proposal_id": proposal["proposal_id"],
        "patch_identity": patch_identity,
        "author_confirmation_event_id": author_confirmation_event_id,
    }
    if any(materialized_payload.get(key) != value for key, value in expected.items()):
        raise ValueError("accepted resolution 与最新 materialized patch 不匹配。")
    index = project_knowledge_entry_index(project_root)
    matching = [
        item
        for item in index.entries
        if item.relative_path == proposal["target_path"]
        and item.entry.id == proposal["knowledge_id"]
        and item.entry.claim_fingerprint == proposal["claim_fingerprint"]
    ]
    if not matching:
        raise ValueError("磁盘上未找到与确认 patch 对应的 Project Knowledge entry。")
