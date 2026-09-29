"""Local, non-exported request snapshots. This is evidence, never a replay scheduler."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy.orm import Session

from app.common.llm_observation import model_observation_scope
from app.common.llm_protocol import provider_family
from app.common.redaction import redact_sensitive
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.platform.ai_sdk import ChatRequest, TokenUsage
from app.platform.ai_sdk.contracts import messages_from_openai, tools_from_openai

REQUEST_EVIDENCE_KIND = "model_request_evidence"
REQUEST_EVIDENCE_VERSION = 1
MAX_REQUEST_SNAPSHOT_BYTES = 2_000_000


class RequestEvidenceError(AgentOrchestrationError):
    """Required local evidence could not be acknowledged; never deliver or replay the result."""


def _encoded(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_encoded(value)).hexdigest()


def _safe_evidence(value: Any, secrets: tuple[str, ...] | list[str | None]) -> Any:
    safe = redact_sensitive(value, extra_secrets=secrets)
    def clean(item: Any) -> Any:
        if isinstance(item, dict):
            return {clean(key): clean(child) for key, child in item.items()}
        if isinstance(item, list):
            return [clean(child) for child in item]
        if isinstance(item, str):
            for secret in secrets:
                if secret:
                    item = item.replace(secret, "[REDACTED]")
        return item
    return clean(safe)


def _without_native_state(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: {"omitted": "native_state_not_persisted"} if key in {
            "continuation", "provider_continuation", "native_state", "thinking_blocks",
            "function_call_signatures", "thought_signature", "thoughtSignature",
        } else _without_native_state(child) for key, child in value.items()}
    if isinstance(value, list | tuple | set):
        return [_without_native_state(child) for child in value]
    return value


def _route_origin(source: Mapping[str, str | None]) -> str | None:
    try:
        url = urlsplit(str(source.get("STORYFORGE_LLM_BASE_URL") or source.get("STORYFORGE_LLM_API_BASE_URL") or ""))
        if url.scheme not in {"https", "http"} or not url.hostname:
            return None
        host = f"[{url.hostname}]" if ":" in url.hostname else url.hostname
        return urlunsplit((url.scheme, host + (f":{url.port}" if url.port else ""), "", "", ""))
    except ValueError:
        return None


def request_snapshot(request: ChatRequest, source: Mapping[str, str | None]) -> dict[str, Any]:
    """Preserve normalized inputs only; native continuation is never inspected."""
    messages, omissions = [], []
    for index, message in enumerate(request.messages):
        item: dict[str, Any] = {"role": message.role.value, "content": message.content}
        if message.tool_calls:
            item["tool_calls"] = [call.to_openai() for call in message.tool_calls]
        if message.tool_call_id is not None:
            item["tool_call_id"] = message.tool_call_id
        if message.name is not None:
            item["name"] = message.name
        if message.continuation is not None:
            omissions.append({"location": f"messages[{index}].continuation", "reason": "native_continuation_not_persisted"})
        if message.metadata:
            omissions.append({"location": f"messages[{index}].metadata", "reason": "untrusted_provider_metadata_not_persisted"})
        messages.append(item)
    metadata = {key: value for key, value in request.metadata.items()
                if key in {"operation", "prompt_version"} and type(value) in {str, int}}
    if len(metadata) != len(request.metadata):
        omissions.append({"location": "metadata", "reason": "untrusted_provider_metadata_not_persisted"})
    normalized = {
        "model": request.model, "messages": messages, "tools": [tool.to_openai() for tool in request.tools],
        "temperature": request.temperature, "max_tokens": request.max_tokens,
        "tool_choice": request.tool_choice, "reasoning_effort": request.reasoning_effort, "metadata": metadata,
    }
    secrets = tuple(value for key, value in source.items()
                    if key.endswith(("_API_KEY", "_AUTH_TOKEN")) and isinstance(value, str) and value)
    safe = _safe_evidence(normalized, secrets)
    redacted = safe != normalized
    if redacted:
        omissions.append({"location": "request", "reason": "secret_redacted"})
    if len(_encoded(safe)) > MAX_REQUEST_SNAPSHOT_BYTES:
        raise AgentOrchestrationError("模型请求证据超出本地快照预算，未派发请求。")
    return {
        "request": safe, "request_digest": _digest(safe), "redacted": redacted, "omissions": omissions,
        "prompt_version": _digest([item for item in safe["messages"] if item["role"] == "system"]),
        "tool_schema_version": _digest(safe["tools"]),
        "sources": [{"kind": "compiled_message", "index": index, "role": item["role"],
                     "sha256": _digest(item), "content_chars": len(item.get("content") or "")}
                    for index, item in enumerate(safe["messages"])],
        "reconstruction": {"normalized_request": not redacted and not any(
            "metadata" in item["location"] for item in omissions),
            "native_wire_replay": False, "requires_reconciliation": bool(omissions)},
    }


def rebuild_normalized_request(payload: Mapping[str, Any]) -> ChatRequest:
    """Offline reconstruction only. It does not replay tools or provider-native state."""
    if payload.get("schema_version") != REQUEST_EVIDENCE_VERSION:
        raise ValueError("unsupported request evidence version")
    request = payload.get("request")
    if not isinstance(request, dict) or _digest(request) != payload.get("request_digest"):
        raise ValueError("request evidence digest mismatch")
    if payload.get("redacted"):
        raise ValueError("redacted request cannot be reconstructed")
    reconstruction = payload.get("reconstruction")
    if not isinstance(reconstruction, dict) or not reconstruction.get("normalized_request"):
        raise ValueError("request metadata was omitted")
    return ChatRequest(
        model=request["model"], messages=messages_from_openai(request["messages"]),
        tools=tools_from_openai(request["tools"]), temperature=request["temperature"],
        max_tokens=request["max_tokens"], tool_choice=request["tool_choice"], reasoning_effort=request["reasoning_effort"],
        metadata=request.get("metadata", {}),
    )


@dataclass
class _StoredAttempt:
    session: Session
    artifact: AgentArtifact
    settled: bool = False

    def _store(self, payload: dict[str, Any]) -> None:
        self.artifact.payload = payload
        self.session.add(self.artifact)
        try:
            self.session.commit()
        except Exception as exc:
            self.session.rollback()
            raise RequestEvidenceError("模型请求证据提交失败，结果需要核对。") from exc

    def finish(self, status: str, *, usage: TokenUsage, finish_reason: str | None = None,
               error_code: str | None = None) -> None:
        if self.settled:
            return
        self._store({**self.artifact.payload, "status": status, "usage": usage.to_legacy(),
                     "finish_reason": finish_reason, "error_code": error_code})
        self.settled = True

    def progress(self, values: Mapping[str, object]) -> None:
        phase = values.get("phase")
        if phase not in {"request_started", "retry_wait", "retry_started"}:
            return
        progress = list(self.artifact.payload.get("transport_progress", []))
        if len(progress) >= 128:
            self._store({**self.artifact.payload, "transport_progress_omitted":
                         int(self.artifact.payload.get("transport_progress_omitted", 0)) + 1})
            return
        allowed = {key: value for key, value in values.items()
                   if key in {"phase", "request_number", "timeout_seconds", "delay_seconds"}}
        progress.append(allowed)
        self._store({**self.artifact.payload, "transport_progress": progress})


@dataclass
class _AgentRequestObserver:
    session: Session
    run: AgentRun

    def begin(self, request: ChatRequest, *, source: Mapping[str, str | None], streaming: bool,
              operation: str, provenance: Mapping[str, Any]) -> _StoredAttempt:
        snapshot = request_snapshot(request, source)
        secrets = [value for key, value in source.items() if key.endswith(("_API_KEY", "_AUTH_TOKEN"))]
        safe_provenance = _safe_evidence(_without_native_state(dict(provenance)), secrets)
        if len(_encoded(safe_provenance)) > MAX_REQUEST_SNAPSHOT_BYTES:
            raise AgentOrchestrationError("模型输入来源证据超出预算，未派发请求。")
        artifact = AgentArtifact(run_id=self.run.id, kind=REQUEST_EVIDENCE_KIND, requires_confirmation=False, payload={
            "schema_version": REQUEST_EVIDENCE_VERSION, "run_id": self.run.public_id,
            "assistant_session_id": self.run.assistant_session_id or provenance.get("assistant_session_id"),
            "attempt_id": str(uuid4()), "step": operation, "run_step": self.run.current_step,
            "status": "prepared", "streaming": streaming,
            "provider_family": provider_family(str(source.get("STORYFORGE_LLM_PROVIDER") or "")),
            "provider_label": _safe_evidence(source.get("STORYFORGE_LLM_PROVIDER"), secrets),
            "route_origin": _safe_evidence(_route_origin(source), secrets),
            "transport_omissions": ["credentials_headers", "route_path_query_fragment", "provider_native_wire"],
            **snapshot, "context_provenance": safe_provenance, "transport_progress": [],
        })
        attempt = _StoredAttempt(self.session, artifact)
        attempt._store(artifact.payload)
        return attempt


@contextmanager
def agent_request_evidence_scope(session: Session, run: AgentRun) -> Iterator[None]:
    with model_observation_scope(_AgentRequestObserver(session, run)):
        yield
