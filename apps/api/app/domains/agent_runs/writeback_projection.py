"""Scoped read-only public projection; historical facts survive terminal delivery."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.external_admission import agent_capabilities
from app.domains.agent_runs.loop.checkpoint_store import latest_checkpoint_artifact
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict, decode_wait
from app.domains.agent_runs.models import AgentRunEvent
from app.domains.agent_runs.service_execution import agent_execution_state
from app.domains.agent_runs.service_store import assert_run_session_ownership, get_agent_run
from app.domains.agent_runs.writeback_contracts import WritebackRead


def read_writeback(session: Session, run_id: str, session_id: str) -> WritebackRead:
    run = get_agent_run(session, run_id)
    assert_run_session_ownership(run, session_id)
    artifact = latest_checkpoint_artifact(session, run)
    if artifact is None:
        raise ExternalWritebackConflict("external_checkpoint_missing")
    wait = decode_wait(artifact.payload, run)
    if run.status not in {"completed", "failed"} and run.current_step != wait.token:
        raise ExternalWritebackConflict("external_wait_token_mismatch")
    latest_event = session.scalar(select(AgentRunEvent).where(AgentRunEvent.run_id == run.id)
                                  .order_by(AgentRunEvent.sequence.desc()).limit(1))
    if latest_event is None:
        raise ExternalWritebackConflict("external_event_missing")
    execution = artifact.payload.get("external_execution", {})
    if not isinstance(execution, dict):
        raise ExternalWritebackConflict("invalid_external_checkpoint")
    capabilities = agent_capabilities()
    return WritebackRead(
        run_id=run.public_id, session_id=run.session_id, assistant_session_id=wait.assistant_session_id,
        wait_id=wait.wait_id, revision=wait.revision,
        stage=wait.stage, run_status=run.status, runtime_state=agent_execution_state(session, run),
        event_sequence=latest_event.sequence, event_id=latest_event.id,
        project_path=wait.project_path, requested_path=wait.requested_path,
        raw_before=wait.raw_before, before_hash=wait.before_hash, after_hash=wait.after_hash,
        operation_key=wait.operation_key, source=wait.source, proposal=wait.proposal, identity=wait.identity,
        decision=wait.decision, observation=wait.observation, historical_applied=wait.historical_applied,
        feedback_consumed=wait.feedback_consumed, delivery_complete=wait.delivery_complete,
        permission_profile=artifact.payload["permission_profile"],
        continuation_available=(wait.execution_epoch is not None and run.status == "paused"
                                and "external_writeback_v1" in capabilities.execution_protocols
                                and capabilities.managed_host_generation == execution.get("host_generation")),
    )
