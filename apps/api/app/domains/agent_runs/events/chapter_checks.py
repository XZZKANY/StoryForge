"""Read-only chapter evidence, scoped to its original conversation and check boundary."""

from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.adapters.chapter_check_protocol import check_source
from app.domains.agent_runs.models import AgentArtifact, AgentRun


def query_chapter_check_history(
    session: Session,
    project_root: str,
    assistant_session_id: int,
    *,
    limit: int = 20,
) -> dict[str, Any]:
    from app.domains.assistant.service import assert_session_project_matches, get_assistant_session

    conversation = get_assistant_session(session, assistant_session_id)
    assert_session_project_matches(conversation, project_root)
    if not 1 <= limit <= 50:
        raise ValueError("检查历史读取上限须为 1–50。")
    rows = session.execute(
        select(AgentArtifact, AgentRun.public_id)
        .join(AgentRun, AgentRun.id == AgentArtifact.run_id)
        .where(AgentRun.assistant_session_id == assistant_session_id, AgentArtifact.kind == "chapter_check")
        .order_by(AgentArtifact.id.desc())
        .limit(limit + 1)
    ).all()
    run_ids = {check.run_id for check, _ in rows[:limit]}
    related = (
        session.scalars(
            select(AgentArtifact)
            .where(
                AgentArtifact.run_id.in_(run_ids),
                AgentArtifact.kind.in_({"chapter_brief", "chapter_candidate"}),
            )
            .order_by(AgentArtifact.id.desc())
        ).all()
        if run_ids
        else []
    )
    boundaries = (
        session.execute(
            select(AgentArtifact.id, AgentArtifact.run_id).where(
                AgentArtifact.run_id.in_(run_ids),
                AgentArtifact.kind == "chapter_check",
            )
        ).all()
        if run_ids
        else []
    )
    entries = []
    for check, run_id in rows[:limit]:
        check_payload = check.payload
        brief = next(
            (
                row.payload
                for row in related
                if row.run_id == check.run_id
                and row.kind == "chapter_brief"
                and row.id < check.id
                and check_source("", row.payload)["brief_sha256"] == check_payload.get("brief_sha256")
            ),
            None,
        )
        next_check = min((id for id, owner in boundaries if owner == check.run_id and id > check.id), default=None)
        candidates = [
            row
            for row in related
            if row.run_id == check.run_id
            and row.kind == "chapter_candidate"
            and row.id > check.id
            and (next_check is None or row.id < next_check)
        ]
        candidate, error = _bound_candidate(candidates, check_payload, brief)
        entries.append(
            {
                "run_id": run_id,
                "check_artifact_id": check.id,
                "created_at": check.created_at,
                "target_path": brief.get("target_path") if brief is not None else None,
                "check": check_payload,
                "candidate": candidate.payload if candidate is not None else None,
                "candidate_artifact_id": candidate.id if candidate is not None else None,
                "candidate_error": error,
            }
        )
    return {
        "project_root": project_root,
        "assistant_session_id": assistant_session_id,
        "entries": entries,
        "truncated": len(rows) > limit,
    }


def _bound_candidate(
    candidates: list[AgentArtifact],
    check: dict[str, Any],
    brief: dict[str, Any] | None,
) -> tuple[AgentArtifact | None, str | None]:
    if not candidates:
        return None, None
    if len(candidates) != 1:
        return None, "此检查对应多个候选记录，归属存在歧义；未展示正文。"
    row = candidates[0]
    payload = row.payload
    content = payload.get("content")
    if (
        brief is None
        or row.requires_confirmation
        or payload.get("read_only") is not True
        or not isinstance(content, str)
        or "before" in payload
        or "after" in payload
        or "approval_action" in payload
        or payload.get("target_path") != brief.get("target_path")
        or payload.get("brief_id") != brief.get("brief_id")
        or payload.get("brief_sha256") != check.get("brief_sha256")
        or payload.get("content_sha256") != check.get("content_sha256")
        or hashlib.sha256(content.encode("utf-8")).hexdigest() != check.get("content_sha256")
    ):
        return None, "候选稿已脱敏或来源绑定不一致，未展示全文；请核对原运行证据。"
    return row, None
