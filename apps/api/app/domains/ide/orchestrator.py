from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.intent import SUPPORTED_INTENTS, _detect_intent

__all__ = [
    "AgentOrchestrationError",
    "SUPPORTED_INTENTS",
    "_detect_intent",
    "orchestrate_agent_message",
]


def orchestrate_agent_message(
    session: Session,
    *,
    agent_session_id: str,
    message: dict[str, Any],
) -> dict[str, Any]:
    """Compatibility facade for the retired IDE Agent orchestrator.

    The live execution path is AgentRuntime. This legacy import path remains
    callable for old integrations and delegates lazily to avoid an import cycle
    with ``agent_runs.runtime``.
    """

    from app.domains.agent_runs.service import AgentRuntimeUserMessageError, run_agent_user_message

    try:
        return run_agent_user_message(
            session,
            agent_session_id=agent_session_id,
            message=message,
        ).result
    except AgentRuntimeUserMessageError as exc:
        raise AgentOrchestrationError(str(exc)) from exc
