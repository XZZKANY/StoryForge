"""Live admission and backend-only, immutable handoff to writing facades."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Any, TypeVar

from app.common.exceptions import ConflictError
from app.common.generation_sources import observe_generation_context, selection_sha256
from app.common.redaction import redact_sensitive
from app.domains.assistant.schemas import (
    AssistantContextBundle,
    AssistantContinueRequest,
    AssistantDraftRequest,
    AssistantReviseRequest,
)

WritingRequest = TypeVar("WritingRequest", AssistantContinueRequest, AssistantDraftRequest, AssistantReviseRequest)


def _identity(project_root: str | None, file_path: str, content: str, intent: str) -> tuple[str | None, str, str, str]:
    # Match the filesystem boundary's canonical project/target identity, including
    # Windows junction aliases. This resolves paths, not manuscript contents.
    root = os.path.normcase(os.path.realpath(project_root)) if project_root else None
    target = os.path.normcase(os.path.realpath(os.path.join(root or "", file_path)))
    return root, target, hashlib.sha256(content.encode("utf-8")).hexdigest(), intent


@dataclass(frozen=True, slots=True)
class PreparedWritingContext:
    """Not a request DTO or a client/model supplied 'already admitted' flag."""

    identity: tuple[str | None, str, str, str] = field(repr=False)
    bundle_json: str = field(repr=False)
    context_receipt_json: str | None = field(default=None, repr=False)

    @property
    def context_bundle(self) -> AssistantContextBundle:
        # Every consumer gets fresh mutable DTO values, never a shared alias.
        return AssistantContextBundle.model_validate_json(self.bundle_json)


def writing_context_from_guarded_bundle(
    raw: dict[str, Any],
    *,
    project_root: str,
    file_path: str,
    content: str,
    intent: str,
    context_receipt: dict[str, Any] | None = None,
) -> PreparedWritingContext:
    """Chapter adapter only: its version guard must pass immediately before handoff.

    Persisted Chapter Brief bundles redact their root to '.'; restore only the
    caller's already validated project identity, not a source supplied root.
    """
    bundle = AssistantContextBundle.model_validate(raw)
    if bundle.project_root != "." and _identity(bundle.project_root, file_path, content, intent) != _identity(
        project_root,
        file_path,
        content,
        intent,
    ):
        raise ConflictError("已守卫章节上下文的项目归属不匹配，请重新生成。")
    bundle.project_root = project_root
    if context_receipt is not None and context_receipt.get("prompt_files_sha256") != selection_sha256(
        [item.model_dump() for item in bundle.files]
    ):
        raise ConflictError("Chapter Brief 的资料投影已变化，请重新生成。")
    return PreparedWritingContext(
        _identity(project_root, file_path, content, intent),
        bundle.model_dump_json(),
        json.dumps(context_receipt, ensure_ascii=False, sort_keys=True) if context_receipt is not None else None,
    )


def writing_context_from_snapshot(
    snapshot: dict[str, Any],
    *,
    project_root: str | None,
    file_path: str,
    content: str,
    intent: str,
) -> PreparedWritingContext:
    from app.domains.agent_runs.llm_context import llm_context_snapshot_to_prompt_context_bundle

    selected = snapshot.get("selected_file") or {}
    captured_root = (snapshot.get("project") or {}).get("project_root")
    if isinstance(captured_root, str) and captured_root.startswith("storyforge://"):
        captured_root = None
    identity = _identity(project_root, file_path, content, intent)
    if (
        snapshot.get("intent") != intent
        or _identity(captured_root, str(selected.get("file_path") or ""), content, intent) != identity
        or selected.get("content_sha256") != identity[2]
    ):
        raise ConflictError("快照与写作目标或正文版本不匹配，请重新准备。")
    bundle = AssistantContextBundle.model_validate(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    source_manifest = redact_sensitive(snapshot.get("source_manifest"))
    receipt = {
        "version": "writer-context-v1",
        "knowledge": snapshot.get("knowledge_recovery"),
        "source_manifest": source_manifest,
        "source_manifest_sha256": selection_sha256(source_manifest),
        "prompt_files_sha256": selection_sha256([item.model_dump() for item in bundle.files]),
    }
    return PreparedWritingContext(
        identity, bundle.model_dump_json(), json.dumps(receipt, ensure_ascii=False, sort_keys=True)
    )


def admit_writing_request(
    payload: WritingRequest,
    *,
    intent: str,
    prepared_context: PreparedWritingContext | None = None,
) -> WritingRequest:
    """Admit raw requests once; validated backend handoffs never re-read synthetic files."""
    content = getattr(payload, "content", "")
    if prepared_context is not None:
        if not isinstance(prepared_context, PreparedWritingContext) or prepared_context.identity != _identity(
            payload.project_root,
            payload.file_path,
            content,
            intent,
        ):
            raise ConflictError("写作上下文与项目、文件、正文或操作不匹配，请重新准备。")
        bundle = prepared_context.context_bundle
    else:
        if payload.context_bundle is None and payload.project_root is None:
            return payload
        from app.domains.agent_runs.llm_context import build_llm_context_snapshot

        raw = payload.context_bundle.model_dump() if payload.context_bundle is not None else {}
        # Request/project identity wins. A bundle cannot redirect filesystem reads.
        raw.update(project_root=payload.project_root or "storyforge://llm-context", current_file=payload.file_path)
        snapshot = build_llm_context_snapshot(
            run_state=None,
            intent=intent,
            user_message=payload.instruction or "续写",
            file_path=payload.file_path,
            content=content,
            context_bundle=raw,
        )
        prepared_context = writing_context_from_snapshot(
            snapshot,
            project_root=payload.project_root,
            file_path=payload.file_path,
            content=content,
            intent=intent,
        )
        bundle = prepared_context.context_bundle
    if prepared_context is not None and prepared_context.context_receipt_json:
        receipt = json.loads(prepared_context.context_receipt_json)
        if receipt.get("prompt_files_sha256") != selection_sha256([item.model_dump() for item in bundle.files]):
            raise ConflictError("写作上下文送达版本不匹配，请重新准备。")
        observe_generation_context(receipt)
    return payload.model_copy(update={"context_bundle": bundle})
