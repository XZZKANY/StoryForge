"""Production v2 checkpoint adapter; preserves control/receipt updates across saves."""
from __future__ import annotations

import math
from copy import deepcopy
from dataclasses import replace

from sqlalchemy import select

from app.domains.agent_runs.loop.checkpoint_store import (
    StoryForgeCheckpointStore,
    adopt_checkpoint,
    build_checkpoint_payload,
    restore_checkpoint_context,
    tool_policy_digest,
)
from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.loop.external_wait_store import commit_external_transition, read_external_wait
from app.domains.agent_runs.loop.external_writeback import publish_external_wait
from app.domains.agent_runs.loop.recovery_sources import sources_unchanged
from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
from app.domains.agent_runs.models import AgentRunEvent
from app.platform.ai_sdk import ChatRequest, RuntimeCheckpoint
from app.platform.ai_sdk.runtime import RuntimePhase


class ExternalChatCheckpointStore:
    def __init__(self, context: StoryForgeRuntimeContext) -> None:
        self.context = context

    def save(self, checkpoint: RuntimeCheckpoint) -> None:
        context = self.context
        execution = context.external_execution
        assert execution is not None
        if execution.stored is None:
            pending = execution.pending
            if checkpoint.external_operation_id is None:
                StoryForgeCheckpointStore(context).save(checkpoint)
                return
            if pending is None or checkpoint.external_operation_id != pending.wait_id:
                raise ExternalWritebackConflict("external_pending_identity_mismatch")
            # This also refuses native continuation before publishing an executable wait.
            execution.stored = publish_external_wait(
                context, checkpoint, proposal=pending.proposal, raw_before=pending.raw_before,
                assistant_tool_call_id=pending.assistant_tool_call_id,
                execution_epoch=execution.lease.execution_epoch, execution_id=execution.execution_id,
            )
            return
        current = read_external_wait(context.session, context.run)
        if not execution.resumed:
            # SDK saves twice around critical notification. A prepare, receipt or
            # control may already have committed: never overwrite it with old wait state.
            execution.stored = current
            adopt_checkpoint(context, current.prepared)
            return
        owner = context.session.scalar(select(AgentRunEvent).where(
            AgentRunEvent.run_id == context.run.id, AgentRunEvent.event_type == "agent_execution_started",
        ).order_by(AgentRunEvent.sequence.desc()).limit(1))
        if (owner is None or owner.id != execution.execution_id or current.wait.stage != "claimed"
                or current.wait.wait_id != execution.stored.wait.wait_id
                or checkpoint.sequence < current.prepared.checkpoint.sequence):
            raise ExternalWritebackConflict("external_checkpoint_owner_changed")
        prepared = build_checkpoint_payload(context, checkpoint)
        # Preserve source-transfer proof and other durable protocol metadata.
        payload = deepcopy(current.prepared.payload)
        payload.update(prepared.payload)
        prepared = replace(prepared, payload=payload)
        execution.stored = commit_external_transition(
            context.session, context.run, previous=current, prepared=prepared, wait=current.wait,
            event_type="agent_writeback_progress",
        )
        adopt_checkpoint(context, execution.stored.prepared)

    def model_started(self, request: ChatRequest) -> None:
        context = self.context
        context.model_outcome_unknown = True
        checkpoint = context.latest_checkpoint or RuntimeCheckpoint(
            context.run.public_id, request.model, RuntimePhase.BEFORE_MODEL, request.messages,
        )
        self.save(replace(checkpoint, messages=request.messages, phase=RuntimePhase.BEFORE_MODEL,
                          round_count=context.provider_attempts))

    def load(self, run_id: str) -> RuntimeCheckpoint:
        context = self.context
        execution = context.external_execution
        assert execution is not None
        current = read_external_wait(context.session, context.run)
        payload, wait, checkpoint = current.prepared.payload, current.wait, current.prepared.checkpoint
        admission = payload.get("external_execution", {})
        from app.domains.agent_runs.loop.external_chat import provider_configuration_digest
        elapsed = payload.get("active_elapsed_seconds")
        if (run_id != context.run.public_id or not execution.resumed or wait.stage != "claimed"
                or wait.execution_epoch != execution.lease.execution_epoch or not wait.feedback_consumed
                or admission.get("host_generation") != execution.lease.host_generation
                or admission.get("provider_configuration_digest") != provider_configuration_digest(context.source)
                or context.run.permission_profile != payload["permission_profile"]
                or payload["tool_policy_digest"] != tool_policy_digest()
                or not sources_unchanged(payload["sources"], payload["resume_message"])
                or payload.get("dispatch_state") != "checkpointed"
                or checkpoint.phase in {RuntimePhase.FAILED, RuntimePhase.COMPLETED}
                or checkpoint.to_dict()["continuation_omitted"]
                or type(elapsed) not in {float, int} or not math.isfinite(elapsed) or elapsed < 0):
            raise ExternalWritebackConflict("external_checkpoint_not_ready")
        context.recovery_message = deepcopy(payload["resume_message"])
        context.active_elapsed_before = float(elapsed)
        context.active_started_at = execution.started_at
        restore_checkpoint_context(context, current.prepared, legacy_patch=False)
        context.write_budget_used = 1
        execution.stored = current
        return checkpoint


def checkpoint_store_for_context(context: StoryForgeRuntimeContext):
    return (ExternalChatCheckpointStore(context) if context.external_execution is not None
            else StoryForgeCheckpointStore(context))
