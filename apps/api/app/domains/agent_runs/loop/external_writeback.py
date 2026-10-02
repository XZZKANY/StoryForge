"""Internal external-writeback lifecycle; no HTTP admission or automatic dispatch.

The caller is a trusted domain adapter. These functions are deliberately not
wired into legacy chat or exposed as renderer-controlled feature switches.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from app.common.redaction import is_sensitive_key, redact_sensitive
from app.domains.agent_runs.fs.native_receipts import (
    NativeReceiptError,
    NativeWritebackIdentity,
    raw_sha256,
)
from app.domains.agent_runs.fs_safety import MAX_READ_BYTES, scoped_target
from app.domains.agent_runs.loop.checkpoint_store import (
    adopt_checkpoint,
    build_checkpoint_payload,
    latest_checkpoint_artifact,
    tool_policy_digest,
)
from app.domains.agent_runs.loop.external_wait_state import (
    ExternalWait,
    ExternalWritebackConflict,
    ReceiptObservation,
    WholeFileProposal,
    encode_wait,
    transfer_sources,
    validate_proposal_bytes,
)
from app.domains.agent_runs.loop.external_wait_store import (
    StoredExternalWait,
    assert_tool_evidence,
    commit_external_transition,
    external_authority_sequence,
    read_external_wait,
    replace_checkpoint,
)
from app.domains.agent_runs.loop.recovery_sources import sources_unchanged
from app.domains.agent_runs.loop.sdk_adapters import StoryForgeFeedbackFormatter, build_storyforge_tool_registry
from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
from app.domains.agent_runs.models import AgentRunEvent
from app.platform.ai_sdk import RuntimeCheckpoint, RuntimeToolResult
from app.platform.ai_sdk.runtime import (
    ExternalToolResolution,
    resolve_external_checkpoint,
    validate_external_checkpoint,
)


def publish_external_wait(
    context: StoryForgeRuntimeContext, checkpoint: RuntimeCheckpoint, *,
    proposal: WholeFileProposal, raw_before: bytes, assistant_tool_call_id: int,
    execution_epoch: str, execution_id: int,
) -> StoredExternalWait:
    """Publish the private proposal + wait + paused token + event in one commit."""
    validate_external_checkpoint(checkpoint)
    if (checkpoint.pending is None or checkpoint.pending.name != "file_revise"
            or not execution_epoch or context.write_budget_exhausted):
        raise ExternalWritebackConflict("external_proposal_not_admissible")
    session, run = context.session, context.run
    session.refresh(run)
    latest = latest_checkpoint_artifact(session, run)
    if latest is not None and latest.payload.get("version") == 2:
        raise ExternalWritebackConflict("write_budget_exhausted")
    if run.permission_profile not in {"ask", "auto", "full"}:
        raise ExternalWritebackConflict("writeback_authorization_required")
    if run.status != "running" or context.recovery_sources is None:
        raise ExternalWritebackConflict("missing_frozen_execution")
    started = session.get(AgentRunEvent, execution_id)
    if (started is None or started.run_id != run.id or started.event_type != "agent_execution_started"):
        raise ExternalWritebackConflict("execution_identity_mismatch")
    raw = validate_proposal_bytes(proposal, raw_before)
    prepared = build_checkpoint_payload(context, checkpoint)
    if (prepared.payload["dispatch_state"] != "checkpointed"
            or not sources_unchanged(prepared.sources, context.recovery_message)):
        raise ExternalWritebackConflict("source_version_changed")
    requested = checkpoint.pending.arguments.get("path")
    if not isinstance(requested, str) or not requested:
        raise ExternalWritebackConflict("missing_target")
    project = context.recovery_message["args"]["project_path"]
    root = Path(project).resolve(strict=True)
    target = scoped_target(root, root / requested)
    with target.open("rb") as stream:
        current_raw = stream.read(MAX_READ_BYTES + 1)
    if not Path(project).is_absolute() or not target.is_file() or current_raw != raw_before:
        raise ExternalWritebackConflict("raw_baseline_mismatch")
    assert_tool_evidence(session, run, assistant_tool_call_id, "file.revise")
    wait = ExternalWait(
        wait_id=checkpoint.external_operation_id, revision=1, stage="await_authorization",
        run_id=run.public_id, session_id=run.session_id, assistant_session_id=context.assistant_session_id,
        tool_call_id=checkpoint.pending.call_id, assistant_tool_call_id=assistant_tool_call_id,
        execution_id=execution_id, execution_epoch=execution_epoch, project_path=project,
        canonical_root=str(root), requested_path=requested, target=target.relative_to(root).as_posix(),
        proposal=proposal, raw_before=raw, before_hash=raw_sha256(raw_before),
        after_hash=raw_sha256(proposal.after.encode("utf-8")), operation_key=f"{proposal.id}:whole",
        source=json.dumps([proposal.id, proposal.before, proposal.after, run.public_id],
                          ensure_ascii=False, separators=(",", ":")),
    )
    transfer_sources(prepared.payload, wait, applied=False)
    prepared = encode_wait(prepared, wait)
    secrets = [v for k, v in context.source.items() if is_sensitive_key(k)]
    if prepared.payload.get("redacted") or redact_sensitive(prepared.payload, extra_secrets=secrets) != prepared.payload:
        raise ExternalWritebackConflict("checkpoint_content_redacted")
    saved = commit_external_transition(session, run, previous=None, prepared=prepared, wait=wait,
                                       expected_step=run.current_step, status="paused",
                                       event_type="agent_writeback_waiting", cancel_after_sequence=started.sequence)
    adopt_checkpoint(context, saved.prepared)
    context.write_budget_used = 1
    return saved


def prepare_external_writeback(
    context: StoryForgeRuntimeContext, *, wait_id: str, expected_revision: int,
    identity: NativeWritebackIdentity, decision: Literal["approve", "auto"],
    permission_profile: str,
    execution_epoch: str | None = None,
) -> StoredExternalWait:
    """Bind one Native identity and trusted control decision; this is NOT applied."""
    current = read_external_wait(context.session, context.run)
    wait = current.wait
    if wait.recovery_id is not None and execution_epoch != wait.execution_epoch:
        raise ExternalWritebackConflict("external_authorization_revoked")
    authority_sequence = external_authority_sequence(context.session, context.run, wait)
    if wait.wait_id != wait_id:
        raise ExternalWritebackConflict("external_wait_identity_mismatch")
    if wait.identity is not None and not (wait.manual_confirmation_required and wait.decision is None and wait.identity == identity):
        if wait.identity == identity and wait.decision == decision:
            if (wait.execution_epoch is None or current.run_status != "paused"
                    or permission_profile != context.run.permission_profile
                    or permission_profile != current.prepared.payload["permission_profile"]):
                raise ExternalWritebackConflict("external_authorization_revoked")
            return current  # Repeat ACK, not a second authority or revision.
        raise ExternalWritebackConflict("native_identity_already_bound")
    if (wait.revision != expected_revision or current.run_status != "paused"
            or wait.stage != "await_authorization" or wait.execution_epoch is None):
        raise ExternalWritebackConflict("external_wait_revision_conflict")
    payload = current.prepared.payload
    if (permission_profile != context.run.permission_profile or permission_profile != payload["permission_profile"]
            or permission_profile == "read" or decision not in {"approve", "auto"}
            or (decision == "auto" and wait.manual_confirmation_required)
            or (decision == "auto" and (permission_profile not in {"auto", "full"} or wait.proposal.requires_confirmation))):
        raise ExternalWritebackConflict("writeback_authorization_required")
    if payload["tool_policy_digest"] != tool_policy_digest() or not sources_unchanged(payload["sources"], payload["resume_message"]):
        raise ExternalWritebackConflict("writeback_context_changed")
    updated = wait.model_copy(update={"identity": identity, "decision": decision, "revision": wait.revision + 1,
                                     "stage": "awaiting_receipt", "manual_confirmation_required": False})
    try:
        updated.binding()  # Independent formula/raw-hash/root validation; no Native effect.
    except NativeReceiptError:
        raise ExternalWritebackConflict("native_identity_invalid") from None
    return commit_external_transition(context.session, context.run, previous=current,
                                     prepared=current.prepared, wait=updated, event_type="agent_writeback_prepared", require_host_open=True,
                                     cancel_after_sequence=authority_sequence)


def reconcile_external_writeback(
    context: StoryForgeRuntimeContext, *, wait_id: str, expected_revision: int,
) -> StoredExternalWait:
    """Read only the bound ledger. No outcome, path or content supplied by a client."""
    current = read_external_wait(context.session, context.run)
    wait = current.wait
    if wait.wait_id != wait_id:
        raise ExternalWritebackConflict("external_wait_identity_mismatch")
    if wait.feedback_consumed:
        adopt_checkpoint(context, current.prepared)
        context.write_budget_used = 1
        return current
    if wait.revision != expected_revision or wait.identity is None:
        raise ExternalWritebackConflict("external_wait_revision_conflict")
    from app.domains.agent_runs.loop.external_observation import observe_external_transition

    prepared, observation, output = observe_external_transition(context, current)
    consumed = output is not None
    if not consumed and wait.observation == observation:
        return current
    updated = wait.model_copy(update={"observation": observation, "revision": wait.revision + 1,
                                     "feedback_consumed": consumed,
                                     "historical_applied": wait.historical_applied or observation.state == "applied",
                                     "stage": "receipt_ready" if consumed else "reconciliation"})
    saved = commit_external_transition(context.session, context.run, previous=current, prepared=prepared,
                                       wait=updated, event_type="agent_writeback_result" if consumed else "agent_writeback_observed",
                                       tool_output=output)
    adopt_checkpoint(context, saved.prepared)
    context.write_budget_used = 1
    return saved


def reject_external_writeback(context: StoryForgeRuntimeContext, *, wait_id: str, expected_revision: int,
                              permission_profile: str, execution_epoch: str | None = None) -> StoredExternalWait:
    """A whole rejection consumes one error feedback; never Native describe/write."""
    current = read_external_wait(context.session, context.run)
    wait, payload = current.wait, current.prepared.payload
    authority_sequence = external_authority_sequence(context.session, context.run, wait)
    if wait.recovery_id is not None and execution_epoch != wait.execution_epoch:
        raise ExternalWritebackConflict("external_authorization_revoked")
    if wait.wait_id != wait_id or wait.revision != expected_revision:
        raise ExternalWritebackConflict("external_wait_revision_conflict")
    if wait.decision == "reject" and wait.feedback_consumed:
        return current
    if (current.run_status != "paused" or wait.stage != "await_authorization"
            or (wait.identity is not None and not wait.manual_confirmation_required)
            or permission_profile != payload["permission_profile"] or permission_profile != context.run.permission_profile
            or permission_profile == "read" or payload["tool_policy_digest"] != tool_policy_digest()
            or not sources_unchanged(payload["sources"], payload["resume_message"])):
        raise ExternalWritebackConflict("external_rejection_not_admissible")
    cp = resolve_external_checkpoint(
        current.prepared.checkpoint,
        ExternalToolResolution(wait.run_id, wait.tool_call_id, wait.wait_id,
                               RuntimeToolResult.failure("author_rejected", "作者拒绝了这份修订，文件未写回。")),
        tool=build_storyforge_tool_registry(context).get(current.prepared.checkpoint.pending.name),
        formatter=StoryForgeFeedbackFormatter(), context=context,
    )
    updated = wait.model_copy(update={"revision": wait.revision + 1, "stage": "receipt_ready", "decision": "reject",
                                     "feedback_consumed": True, "manual_confirmation_required": False,
                                     "observation": ReceiptObservation(state="not_written", current="before",
                                                                        reason="author_rejected")})
    prepared = replace_checkpoint(current.prepared, cp, current.prepared.sources)
    saved = commit_external_transition(context.session, context.run, previous=current, prepared=prepared, wait=updated,
                                       event_type="agent_writeback_rejected", tool_status="failed",
                                       tool_output={"applied": False, "rejected": True, "path": wait.requested_path},
                                       cancel_after_sequence=authority_sequence)
    adopt_checkpoint(context, saved.prepared)
    context.write_budget_used = 1
    return saved
