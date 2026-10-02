"""Private durable runtime state: no checkpoint body is broadcast as an event."""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import asdict, dataclass, replace
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.redaction import is_sensitive_key, redact_sensitive
from app.domains.agent_runs.loop.recovery_sources import source_versions, sources_unchanged
from app.domains.agent_runs.loop.types import ChatLoopOutcome
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.agent_runs.tools import ToolArtifact, list_loop_tool_specs
from app.domains.agent_runs.trace import AgentToolTrace
from app.platform.ai_sdk import ChatRequest, RuntimeCheckpoint
from app.platform.ai_sdk.runtime import RuntimePhase

if TYPE_CHECKING:
    from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext

RUNTIME_CHECKPOINT_KIND = "runtime_checkpoint"


def payload_digest(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps({k: v for k, v in payload.items() if k != "sha256"},
                                     ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def tool_policy_digest() -> str:
    values = [asdict(spec) for spec in list_loop_tool_specs()]
    return hashlib.sha256(json.dumps(values, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def latest_checkpoint_artifact(session: Session, run: AgentRun) -> AgentArtifact | None:
    return session.scalar(select(AgentArtifact).where(
        AgentArtifact.run_id == run.id, AgentArtifact.kind == RUNTIME_CHECKPOINT_KIND,
    ).order_by(AgentArtifact.id.desc()).limit(1).execution_options(populate_existing=True))


def checkpoint_diagnostic(payload: dict[str, Any], run: AgentRun) -> dict[str, Any]:
    reason = None
    value = payload.get("checkpoint")
    message = payload.get("resume_message")
    if payload.get("version") == 2:
        # Ordinary resume/approve is never the dedicated external-result consumer.
        return {"kind": "runtime_checkpoint_resume", "can_resume": False,
                "reason": "external_writeback_control_required", "resume_strategy": "reconciliation_required",
                "requires_manual_restart": False, "resume_via_control_channel": False}
    if payload.get("version") != 1 or not isinstance(value, dict):
        reason = "invalid_checkpoint"
    elif payload.get("sha256") != payload_digest(payload):
        reason = "checkpoint_digest_mismatch"
    elif (not isinstance(message, dict) or not isinstance(message.get("args"), dict)
          or not isinstance(message["args"].get("project_path"), str)):
        reason = "missing_resume_context"
    elif payload.get("redacted"):
        reason = "checkpoint_content_redacted"
    elif value.get("continuation_omitted"):
        reason = "provider_continuation_unavailable"
    elif payload.get("dispatch_state") == "model_outcome_unknown":
        reason = "model_outcome_unknown"
    elif value.get("phase") in {"failed", "completed"}:
        reason = "terminal_checkpoint_requires_delivery_reconciliation"
    elif value.get("run_id") != run.public_id or payload.get("assistant_session_id") != run.assistant_session_id:
        reason = "checkpoint_identity_mismatch"
    elif payload.get("permission_profile") != run.permission_profile:
        reason = "permission_snapshot_changed"
    elif not sources_unchanged(payload.get("sources", {}), payload.get("resume_message", {})):
        reason = "source_version_changed"
    elif payload.get("tool_policy_digest") != tool_policy_digest():
        reason = "tool_policy_changed"
    pending = value.get("pending") if isinstance(value, dict) else None
    if reason is None and isinstance(pending, dict) and (pending.get("attempt", 0) > 0 or value.get("phase") == "tool_started"):
        policies = {s.name.replace(".", "_"): s for s in list_loop_tool_specs()}
        policy = policies.get(pending.get("name"))
        if policy is None or not (policy.idempotent and policy.retry_safe):
            reason = "tool_outcome_unknown"
    return {"kind": "runtime_checkpoint_resume", "can_resume": reason is None,
            "reason": reason or "durable_checkpoint_ready",
            "resume_strategy": "reconciliation_required" if reason else "continue_checkpoint",
            "requires_manual_restart": False, "resume_via_control_channel": reason is None}


def outcome_payload(outcome: ChatLoopOutcome) -> dict[str, Any]:
    result = {name: getattr(outcome, name) for name in (
        "rounds", "tool_call_count", "completion_tokens", "prompt_tokens", "token_usage",
        "token_usage_source", "cost_cny_estimated", "cost_breakdown", "review_report",
    )}
    result.update(traces=[t.as_dict() for t in outcome.traces], proposed_patch=outcome.proposed_patch,
                  artifacts=[asdict(a) for a in outcome.artifacts])
    return result


@dataclass(frozen=True)
class PreparedCheckpoint:
    """Detached payload and context changes; preparation does not commit either."""

    checkpoint: RuntimeCheckpoint
    payload: dict[str, Any]
    sources: dict[str, Any]


def build_checkpoint_payload(context: StoryForgeRuntimeContext, checkpoint: RuntimeCheckpoint) -> PreparedCheckpoint:
    """Read source versions without changing the Session or adopting new baselines."""
    if checkpoint.run_id != context.run.public_id:
        raise ValueError("checkpoint_identity_mismatch")
    current_sources = source_versions(checkpoint, context.recovery_message)
    sources = deepcopy(context.recovery_sources) if context.recovery_sources is not None else current_sources
    for path, digest in current_sources["files"].items():
        sources["files"].setdefault(path, digest)
    payload = {"version": 1, "checkpoint": checkpoint.to_dict(),
               "assistant_session_id": context.assistant_session_id,
               "permission_profile": context.run.permission_profile,
               "tool_policy_digest": tool_policy_digest(),
               "resume_message": context.recovery_message,
               "sources": sources,
               "outcome": outcome_payload(context.outcome),
               "dispatch_state": "model_outcome_unknown" if context.model_outcome_unknown else "checkpointed"}
    if context.external_execution is not None:
        from app.domains.agent_runs.loop.external_chat import provider_configuration_digest

        lease = context.external_execution.lease
        payload.update(active_elapsed_seconds=context.active_elapsed_seconds(),
                       external_execution={"protocol": "external_writeback_v1",
                                           "host_generation": lease.host_generation,
                                             "provider_configuration_digest": provider_configuration_digest(context.source),
                                           "execution_epoch": lease.execution_epoch})
    secrets = [value for key, value in context.source.items() if is_sensitive_key(key)]
    safe = redact_sensitive(payload, extra_secrets=secrets)
    safe["redacted"] = safe != payload
    safe["sha256"] = payload_digest(safe)
    return PreparedCheckpoint(checkpoint, safe, sources)


def append_checkpoint(session: Session, run: AgentRun, prepared: PreparedCheckpoint) -> AgentArtifact:
    """Stage only. The owner must commit/rollback with its state and event changes."""
    if (prepared.checkpoint.run_id != run.public_id
            or prepared.payload["assistant_session_id"] != run.assistant_session_id):
        raise ValueError("checkpoint_identity_mismatch")
    artifact = AgentArtifact(run_id=run.id, kind=RUNTIME_CHECKPOINT_KIND,
                             payload=deepcopy(prepared.payload), requires_confirmation=False)
    session.add(artifact)
    return artifact


def adopt_checkpoint(context: StoryForgeRuntimeContext, prepared: PreparedCheckpoint) -> None:
    """Apply in-memory changes only AFTER the owning transaction committed."""
    context.recovery_sources = deepcopy(prepared.sources)
    context.latest_checkpoint = prepared.checkpoint


class StoryForgeCheckpointStore:
    def __init__(self, context: StoryForgeRuntimeContext) -> None:
        self._context = context

    def save(self, checkpoint: RuntimeCheckpoint) -> None:
        context = self._context
        latest = latest_checkpoint_artifact(context.session, context.run)
        if latest is not None and latest.payload.get("version") == 2:
            raise ValueError("external_checkpoint_requires_domain_transaction")
        prepared = build_checkpoint_payload(context, checkpoint)
        try:
            append_checkpoint(context.session, context.run, prepared)
            context.session.commit()
        except BaseException:
            context.session.rollback()
            raise
        adopt_checkpoint(context, prepared)

    def model_started(self, request: ChatRequest) -> None:
        context = self._context
        context.model_outcome_unknown = True
        checkpoint = context.latest_checkpoint or RuntimeCheckpoint(
            context.run.public_id, request.model, RuntimePhase.BEFORE_MODEL, request.messages,
        )
        self.save(replace(checkpoint, messages=request.messages, phase=RuntimePhase.BEFORE_MODEL,
                          round_count=context.provider_attempts))

    def load(self, run_id: str) -> RuntimeCheckpoint | None:
        context = self._context
        if run_id != context.run.public_id:
            return None
        item = latest_checkpoint_artifact(context.session, context.run)
        if item is None:
            return None
        diagnostic = checkpoint_diagnostic(item.payload, context.run)
        if not diagnostic["can_resume"]:
            raise ValueError(diagnostic["reason"])
        checkpoint = RuntimeCheckpoint.from_dict(item.payload["checkpoint"])
        prepared = PreparedCheckpoint(checkpoint, item.payload, item.payload["sources"])
        restore_checkpoint_context(context, prepared, legacy_patch=True)
        return checkpoint


def restore_checkpoint_context(context: StoryForgeRuntimeContext, prepared: PreparedCheckpoint,
                               *, legacy_patch: bool) -> None:
    """Shared outcome/call restoration; v2 never injects proposal into legacy delivery."""
    checkpoint = prepared.checkpoint
    adopt_checkpoint(context, prepared)
    raw = prepared.payload["outcome"]
    for name in ("rounds", "tool_call_count", "completion_tokens", "prompt_tokens", "token_usage",
                 "token_usage_source", "cost_cny_estimated", "cost_breakdown", "review_report"):
        setattr(context.outcome, name, raw[name])
    context.outcome.traces = [AgentToolTrace(**trace) for trace in raw["traces"]]
    context.outcome.artifacts = [ToolArtifact(**artifact) for artifact in raw["artifacts"]]
    context.outcome.proposed_patch = raw["proposed_patch"]
    if legacy_patch and context.outcome.proposed_patch is not None:
        context.outcome.proposed_patch = {**context.outcome.proposed_patch, "requires_confirmation": True}
        context.outcome.artifacts = [
            ToolArtifact(artifact.kind, {**artifact.payload, "requires_confirmation": True}, True)
            if artifact.kind == "proposed_patch" else artifact for artifact in context.outcome.artifacts
        ]
    context.calls_by_id = {call.id: call for message in checkpoint.messages for call in message.tool_calls}
    context.handled_call_ids = set(checkpoint.completed_tool_call_ids)
    context.completed_model_rounds = checkpoint.round_count
    context.provider_attempts = checkpoint.round_count
