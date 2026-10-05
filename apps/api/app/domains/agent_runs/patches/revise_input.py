"""Resolve report ownership and author scope before the writer receives either."""

from typing import Any

from app.domains.agent_runs.events.review_sources import current_conversation_review
from app.domains.agent_runs.revise_delivery import verify_review_source
from app.domains.agent_runs.revise_scope import (
    resolve_revise_scope,
    revision_references_review,
    scoped_revise_instruction,
)
from app.domains.agent_runs.tools import ToolExecutionContext


def prepare_revision_scope(
    context: ToolExecutionContext,
    payload: dict[str, Any],
    *,
    instruction: str,
    file_path: str,
    content: str,
    project_root: str | None,
) -> tuple[dict[str, Any] | None, dict[str, Any], str]:
    report = payload.get("review_report") if isinstance(payload.get("review_report"), dict) else None
    directed = revision_references_review(context.user_message)
    if report is not None or directed:
        report = current_conversation_review(
            context.session,
            context.assistant_session_id,
            offered=report,
            transient=context.current_review_report,
            required=directed,
        )
    if directed:
        instruction = context.user_message
    verify_review_source(report, file_path, content, project_root)
    scope = resolve_revise_scope(
        report,
        {**payload, "instruction": instruction},
        author_instruction=context.user_message if directed else None,
    )
    return report, scope, scoped_revise_instruction(instruction, report, scope)
