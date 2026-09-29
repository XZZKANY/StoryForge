"""Private durable runtime state: no checkpoint body is broadcast as an event."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, replace
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


class StoryForgeCheckpointStore:
    def __init__(self, context: StoryForgeRuntimeContext) -> None:
        self._context = context

    def save(self, checkpoint: RuntimeCheckpoint) -> None:
        context = self._context
        current_sources = source_versions(checkpoint, context.recovery_message)
        if context.recovery_sources is None:
            context.recovery_sources = current_sources
        else:
            for path, digest in current_sources["files"].items():
                context.recovery_sources["files"].setdefault(path, digest)
        payload = {"version": 1, "checkpoint": checkpoint.to_dict(),
                   "assistant_session_id": context.assistant_session_id,
                   "permission_profile": context.run.permission_profile,
                   "tool_policy_digest": tool_policy_digest(),
                   "resume_message": context.recovery_message,
                   "sources": context.recovery_sources,
                   "outcome": outcome_payload(context.outcome),
                   "dispatch_state": "model_outcome_unknown" if context.model_outcome_unknown else "checkpointed"}
        secrets = [value for key, value in context.source.items() if is_sensitive_key(key)]
        safe = redact_sensitive(payload, extra_secrets=secrets)
        safe["redacted"] = safe != payload
        safe["sha256"] = payload_digest(safe)
        artifact = AgentArtifact(run_id=context.run.id, kind=RUNTIME_CHECKPOINT_KIND,
                                 payload=safe, requires_confirmation=False)
        try:
            context.session.add(artifact)
            context.session.commit()
        except BaseException:
            context.session.rollback()
            raise
        context.latest_checkpoint = checkpoint

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
        context.latest_checkpoint = checkpoint
        context.recovery_sources = item.payload["sources"]
        raw = item.payload["outcome"]
        for name in ("rounds", "tool_call_count", "completion_tokens", "prompt_tokens", "token_usage",
                     "token_usage_source", "cost_cny_estimated", "cost_breakdown", "review_report"):
            setattr(context.outcome, name, raw[name])
        context.outcome.traces = [AgentToolTrace(**trace) for trace in raw["traces"]]
        context.outcome.artifacts = [ToolArtifact(**artifact) for artifact in raw["artifacts"]]
        context.outcome.proposed_patch = raw["proposed_patch"]
        if context.outcome.proposed_patch is not None:
            context.outcome.proposed_patch = {**context.outcome.proposed_patch, "requires_confirmation": True}
            context.outcome.artifacts = [
                ToolArtifact(artifact.kind, {**artifact.payload, "requires_confirmation": True}, True)
                if artifact.kind == "proposed_patch" else artifact for artifact in context.outcome.artifacts
            ]
        context.calls_by_id = {call.id: call for message in checkpoint.messages for call in message.tool_calls}
        context.handled_call_ids = set(checkpoint.completed_tool_call_ids)
        context.completed_model_rounds = checkpoint.round_count
        context.provider_attempts = checkpoint.round_count
        return checkpoint
