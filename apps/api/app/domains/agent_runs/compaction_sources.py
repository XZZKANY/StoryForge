"""Versioned, read-only source projection for conversation checkpoints."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent
from app.domains.assistant.models import AssistantMessage, AssistantToolCall

SYSTEM_COMPACTION_ARTIFACT_KIND = "system_compaction"
SYSTEM_COMPACTION_SCHEMA_VERSION = 2
HISTORY_BUDGET_BYTES = 128_000
COMPACTION_INPUT_BUDGET_BYTES = 196_000
COMPACTION_MESSAGE_THRESHOLD = 12
COMPACTION_CHAR_THRESHOLD = 8000
COMPACTION_RETAINED_MESSAGE_COUNT = 4


class ContextBudgetError(AgentOrchestrationError):
    """No lossless author/evidence projection fits the configured history budget."""


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_digest(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def check_context_budget(value: object, maximum: int = HISTORY_BUDGET_BYTES) -> None:
    if len(canonical_json(value).encode("utf-8")) > maximum:
        raise ContextBudgetError("上下文超出保真预算，请整理作者约束或开启新会话；未静默删除历史。")


def message_sources(session: Session, assistant_session_id: int) -> list[dict[str, Any]]:
    messages = session.scalars(select(AssistantMessage).where(
        AssistantMessage.session_id == assistant_session_id,
    ).order_by(AssistantMessage.id).execution_options(populate_existing=True)).all()
    sources = []
    for message in messages:
        record = {"key": f"message:{message.id}", "id": message.id,
                  "role": message.role, "content": message.content}
        sources.append({**record, "digest": content_digest(record)})
    return sources


def source_reference(source: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in source.items() if key != "content"}


def _evidence_content(value: object) -> object:
    """Keep state exactly; manuscript bodies stay in the referenced original artifact."""
    if isinstance(value, dict):
        return {key: (
            {"omitted": "manuscript_body", "digest": content_digest(item)}
            if key in {"before", "after", "content", "original_text", "revised_text"}
            else _evidence_content(item)
        ) for key, item in value.items()}
    if isinstance(value, list):
        return [_evidence_content(item) for item in value]
    return value


def evidence_sources(session: Session, assistant_session_id: int) -> list[dict[str, Any]]:
    # No inference of writeback from approval: these are dated facts, not filesystem truth.
    events = session.scalars(select(AgentRunEvent).join(AgentRun).where(
        AgentRun.assistant_session_id == assistant_session_id,
        AgentRunEvent.event_type.in_((
            "permission_required", "permission_approved", "permission_denied",
            "knowledge_proposal_accepted", "knowledge_proposal_rejected",
            "knowledge_proposal_invalidated", "knowledge_evidence_stale",
            "stop_run", "pause_run", "retry_from_checkpoint",
            "agent_run_interrupted", "agent_run_completed", "agent_run_failed",
        )),
    ).order_by(AgentRunEvent.id).execution_options(populate_existing=True)).all()
    artifacts = session.scalars(select(AgentArtifact).join(AgentRun).where(
        AgentRun.assistant_session_id == assistant_session_id,
        AgentArtifact.kind.not_in((
            "system_summary", SYSTEM_COMPACTION_ARTIFACT_KIND,
            "model_request_evidence", "runtime_checkpoint",
        )),
    ).order_by(AgentArtifact.id).execution_options(populate_existing=True)).all()
    sources = []
    for artifact in artifacts:
        raw = {"kind": artifact.kind, "run_id": artifact.run_id,
               "requires_confirmation": artifact.requires_confirmation, "payload": artifact.payload}
        sources.append({"key": f"artifact:{artifact.id}", "id": artifact.id, "role": "evidence",
                        "digest": content_digest(raw), "content": canonical_json(_evidence_content(raw))})
    for event in events:
        if (event.event_type in {"agent_run_completed", "agent_run_failed"}
                and event.payload.get("control_type") not in {"approve_permission", "deny_permission"}):
            continue
        raw = {"event_type": event.event_type, "run_id": event.run_id,
               "sequence": event.sequence, "message": event.message, "payload": event.payload}
        sources.append({"key": f"event:{event.id}", "id": event.id, "role": "evidence",
                        "digest": content_digest(raw), "content": canonical_json(_evidence_content(raw))})
    calls = session.scalars(select(AssistantToolCall).where(
        AssistantToolCall.session_id == assistant_session_id,
        AssistantToolCall.tool_name != "conversation.compact",
    ).order_by(AssistantToolCall.id).execution_options(populate_existing=True)).all()
    for call in calls:
        raw = {"tool_name": call.tool_name, "status": call.status,
               "input_summary": call.input_summary, "output_summary": call.output_summary,
               "related_type": call.related_type, "related_id": call.related_id}
        sources.append({"key": f"tool:{call.id}", "id": call.id, "role": "evidence",
                        "digest": content_digest(raw), "content": canonical_json(_evidence_content(raw))})
    return sources


def current_evidence_overlay(sources: list[dict[str, Any]]) -> dict[str, Any]:
    permissions: dict[int, dict[str, Any]] = {}
    for source in sources:
        if not source["key"].startswith("event:"):
            continue
        raw = json.loads(source["content"])
        event_type = raw.get("event_type")
        payload = raw.get("payload") or {}
        permission = None
        if event_type == "permission_required":
            permission = "required"
        elif event_type in {"permission_approved", "permission_denied"}:
            if payload.get("control_effect") == "applied":
                permission = event_type.removeprefix("permission_")
        elif event_type in {"agent_run_completed", "agent_run_failed"}:
            # Legacy controls without effect are not evidence of a transition. A matching
            # durable terminal settlement carrying control_type is the corroborating fact.
            permission = {"approve_permission": "approved", "deny_permission": "denied"}.get(
                payload.get("control_type"),
            )
        elif (event_type == "agent_run_interrupted" and payload.get("run_status") in {"paused", "stopped"}
              or event_type in {"pause_run", "stop_run"} and payload.get("control_effect") in {"requested", "applied"}):
            permission = "cancelled"
        if permission is not None:
            permissions[raw["run_id"]] = {
                "source_id": source["key"], "permission": permission,
                "writeback": "unverified", "pending_patch_available": permission == "required",
            }
    return {"permission_by_run": permissions, "sources": sources,
            "rule": "permission_by_run 是有效结算投影；ignored 控制不改变状态。停止/中断使旧补丁不可继续确认。"
                    "批准仅为权限事实，不是写盘。没有 Desktop 回执不可宣称已写盘。"}
