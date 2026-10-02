"""Pure ledger-to-checkpoint conversion; the caller owns the single transaction."""

from __future__ import annotations

from app.domains.agent_runs.fs.native_receipts import NativeReceiptError, inspect_native_writeback, raw_sha256
from app.domains.agent_runs.loop.external_wait_state import (
    ExternalWritebackConflict,
    ReceiptObservation,
    transfer_sources,
)
from app.domains.agent_runs.loop.external_wait_store import replace_checkpoint
from app.domains.agent_runs.loop.sdk_adapters import StoryForgeFeedbackFormatter, build_storyforge_tool_registry
from app.platform.ai_sdk import RuntimeToolResult
from app.platform.ai_sdk.runtime import ExternalToolResolution, RuntimeLimits, resolve_external_checkpoint


def observe_external_transition(context, current):
    """No DB mutation, provider dispatch or manuscript write; retain applied history."""
    wait = current.wait
    prepared = current.prepared
    output = None
    observation = None
    try:
        observed = inspect_native_writeback(wait.binding())
        observation = (
            ReceiptObservation(state="missing", reason="native_receipt_missing")
            if observed is None
            else ReceiptObservation(
                state=observed.state, current=observed.current, receipt_persisted=observed.receipt_persisted
            )
        )
        applied = observed is not None and observed.state == "applied"
        ready = (
            observed is not None
            and observed.receipt_persisted
            and (
                (applied and observed.verified_after is not None)
                or (observed.state == "not_written" and observed.current == "before")
            )
        )
        if ready:
            # Permission changes/stop never erase applied history. They only park continuation.
            sources = transfer_sources(prepared.payload, wait, applied=applied)
            if applied and raw_sha256(observed.verified_after.encode("utf-8")) != wait.after_hash:
                raise ExternalWritebackConflict("readback_mismatch")
            output = {
                "applied": applied,
                "path": wait.requested_path,
                "operation_id": wait.identity.operation_id,
                "receipt_persisted": True,
                "current": observed.current,
            }
            tool = build_storyforge_tool_registry(context).get(prepared.checkpoint.pending.name)
            cp = resolve_external_checkpoint(
                prepared.checkpoint,
                ExternalToolResolution(wait.run_id, wait.tool_call_id, wait.wait_id, RuntimeToolResult.success(output)),
                tool=tool,
                formatter=StoryForgeFeedbackFormatter(),
                context=context,
                limits=RuntimeLimits(max_tool_output_chars=60000),
            )
            prepared = replace_checkpoint(prepared, cp, sources)
            # A compact transfer proof, never manuscript text in public event/evidence.
            prepared.payload["source_transfer"] = {
                "target": wait.target,
                "from_hash": wait.before_hash,
                "to_hash": wait.after_hash if applied else wait.before_hash,
                "operation_id": wait.identity.operation_id,
            }
        elif observed is not None and observed.state == "applied":
            observation = observation.model_copy(update={"reason": "applied_readback_changed"})
    except (NativeReceiptError, ExternalWritebackConflict, OSError, ValueError):
        # Never turn an observed historical applied fact into not_written on peer drift.
        prior = observation
        observation = (
            prior.model_copy(update={"reason": "source_or_binding_changed"})
            if isinstance(prior, ReceiptObservation) and prior.state == "applied"
            else ReceiptObservation(state="invalid", reason="receipt_or_binding_invalid")
        )
        output = None
        prepared = current.prepared
    return prepared, observation, output
