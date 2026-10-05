"""Resolve a current conversation's report, never an issue ID alone."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentArtifact, AgentRun


def current_conversation_review(
    session: Session,
    assistant_session_id: int,
    *,
    offered: dict[str, Any] | None = None,
    transient: dict[str, Any] | None = None,
    required: bool = False,
) -> dict[str, Any] | None:
    stored = transient
    if stored is None:
        artifact = session.scalars(
            select(AgentArtifact)
            .join(AgentRun, AgentRun.id == AgentArtifact.run_id)
            .where(AgentRun.assistant_session_id == assistant_session_id, AgentArtifact.kind == "review_report")
            .order_by(AgentArtifact.id.desc())
            .limit(1)
        ).first()
        stored = artifact.payload if artifact is not None else None
    if offered is not None:
        # Old unbound reports remain a compatibility input for non-report-directed
        # requests only; they cannot certify an ordinal or supersede persisted truth.
        if not offered.get("report_id") and not offered.get("content_sha256") and not required:
            return offered
        if not stored or not stored.get("report_id") or offered.get("report_id") != stored["report_id"]:
            raise AgentOrchestrationError("审稿报告不是当前会话的最新报告，请重新审稿后修订。")
    if required and (not stored or not stored.get("report_id") or not stored.get("content_sha256")):
        raise AgentOrchestrationError("当前会话没有已绑定的审稿报告，请先审稿再选择问题。")
    return stored
