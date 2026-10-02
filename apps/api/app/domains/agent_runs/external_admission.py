"""Closed release gate and managed-host negotiation, never inferred from localhost."""
from __future__ import annotations

import os
import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.loop.external_chat import ExternalExecutionLease
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.writeback_contracts import AgentCapabilitiesRead, ExecutionProtocol

# P1 + P2 acceptance must be recorded before changing this release decision.
RELEASE_GATE_PASSED = False


def agent_capabilities() -> AgentCapabilitiesRead:
    generation = os.getenv("STORYFORGE_MANAGED_HOST_GENERATION", "")
    if re.fullmatch(r"[0-9a-f]{64}", generation) is None:
        return AgentCapabilitiesRead(disabled_reason="managed_host_unavailable")
    if not RELEASE_GATE_PASSED:
        return AgentCapabilitiesRead(managed_host_generation=generation, disabled_reason="release_gate_closed")
    if os.getenv("STORYFORGE_EXTERNAL_WRITEBACK_ENABLED") != "1":
        return AgentCapabilitiesRead(managed_host_generation=generation, disabled_reason="host_protocol_disabled")
    return AgentCapabilitiesRead(execution_protocols=["external_writeback_v1"], managed_host_generation=generation)


def require_managed_protocol(host_generation: str | None) -> str:
    from app.domains.agent_runs.host_lifecycle import HOST_LIFECYCLE

    HOST_LIFECYCLE.require_open()
    capability = agent_capabilities()
    if ("external_writeback_v1" not in capability.execution_protocols or host_generation is None
            or host_generation != capability.managed_host_generation):
        raise ExternalWritebackConflict("external_writeback_not_negotiated")
    return host_generation


def admit_stream_protocol(session: Session, *, protocol: ExecutionProtocol, session_id: str,
                          run_id: str | None, host_generation: str | None,
                          intent: str | None) -> ExternalExecutionLease | None:
    existing = session.scalar(select(AgentRun).where(AgentRun.public_id == run_id)) if run_id else None
    if protocol == "legacy":
        if existing is not None and existing.scope.get("execution_protocol") == "external_writeback_v1":
            raise ExternalWritebackConflict("external_writeback_cannot_replay_user_message")
        return None
    generation = require_managed_protocol(host_generation)
    if existing is not None or intent not in {None, "chat.explain"}:
        raise ExternalWritebackConflict("external_writeback_requires_new_chat_run")
    return ExternalExecutionLease(run_id=run_id or uuid.uuid4().hex, session_id=session_id,
                                  execution_epoch=uuid.uuid4().hex, host_generation=generation)
