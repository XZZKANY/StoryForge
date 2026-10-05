"""Freeze the sources behind a confirmed Brief, not just its old bundle excerpts."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

from app.common.author_voice import build_generation_system_prompt
from app.common.generation_sources import MAX_MANIFEST_BYTES, GenerationSourceCapture
from app.common.manuscript import previous_chapter_tail
from app.common.redaction import redact_sensitive_text
from app.domains.agent_runs.canon_context import build_scene_constraint_block
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.fs import (
    FsToolError,
    normalize_project_relative_path,
    resolve_project_root,
    resolve_scoped_path,
)
from app.domains.agent_runs.loop import writing_context_sources_unchanged
from app.domains.assistant.writing_context import (
    PreparedWritingContext,
    writing_context_from_guarded_bundle,
    writing_context_from_snapshot,
)

_VERSION = 2
_FIXED_SOURCES = (".storyforge/agent-instructions.md", ".storyforge/canon/canon.json", ".storyforge/canon/hooks.json")
_MAX_SOURCE_BYTES = 4_000_000
_DRIFT = "Chapter Brief 的来源在确认期间已变化，请重新生成 Brief 后再确认。"


def capture_chapter_sources(
    project_root: str, target_absolute: str, bundle: Mapping[str, Any], *, snapshot: dict[str, Any], user_message: str
) -> dict[str, Any]:
    prepared = writing_context_from_snapshot(
        snapshot, project_root=project_root, file_path=target_absolute, content="", intent="chapter.write"
    )
    paths = set(_FIXED_SOURCES)
    for item in bundle.get("files", []):
        if not isinstance(item, Mapping):
            continue
        if str(item.get("path") or "").startswith("storyforge://llm-context/"):
            continue
        try:
            paths.add(normalize_project_relative_path(str(item.get("relative_path") or "")))
        except FsToolError as exc:
            raise AgentOrchestrationError("Chapter Brief 的来源路径无法验证，请重新生成。") from exc
    identity = GenerationSourceCapture(project_root, current_file=target_absolute)
    guard = {
        "version": _VERSION,
        "project_identity_sha256": identity.project_identity_sha256,
        "target_relative": identity.writing_context["current_file"] if identity.writing_context else None,
        "paths": sorted(paths),
        "context": {
            "current_file": snapshot["selected_file"]["file_path"],
            "user_message": redact_sensitive_text(user_message),
            "receipt": json.loads(prepared.context_receipt_json),
        },
    }
    guard["sha256"] = _source_signature(project_root, target_absolute, guard["paths"])
    # Qualify the consumed snapshot after sampling other dependencies. A later
    # filesystem observation cannot replace the original ordinary/knowledge version.
    assert_chapter_sources(project_root, target_absolute, guard)
    return guard


def assert_chapter_sources(project_root: str, target_absolute: str, guard: object) -> None:
    if not isinstance(guard, Mapping) or guard.get("version") != _VERSION:
        raise AgentOrchestrationError("Chapter Brief 缺少来源版本，请重新生成。")
    paths = guard.get("paths")
    expected = guard.get("sha256")
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths) or not isinstance(expected, str):
        raise AgentOrchestrationError("Chapter Brief 来源版本无法验证，请重新生成。")
    context = guard.get("context")
    identity = GenerationSourceCapture(project_root, current_file=target_absolute)
    if (
        len(json.dumps(guard, ensure_ascii=False).encode("utf-8")) > MAX_MANIFEST_BYTES
        or not identity.writing_context
        or guard.get("project_identity_sha256") != identity.project_identity_sha256
        or guard.get("target_relative") != identity.writing_context["current_file"]
        or not isinstance(context, dict)
        or not isinstance(context.get("current_file"), str)
        or not isinstance(context.get("user_message"), str)
        or not writing_context_sources_unchanged(
            context.get("receipt"),
            resolve_project_root(project_root),
            current_file=context["current_file"],
            user_message=context["user_message"],
        )
    ):
        raise AgentOrchestrationError(_DRIFT)
    if _source_signature(project_root, target_absolute, paths) != expected:
        raise AgentOrchestrationError(_DRIFT)


def prepare_chapter_writing_context(
    project_root: str, target_absolute: str, bundle: dict[str, Any], guard: dict[str, Any], *, content: str, intent: str
) -> PreparedWritingContext:
    assert_chapter_sources(project_root, target_absolute, guard)
    return writing_context_from_guarded_bundle(
        bundle,
        project_root=project_root,
        file_path=target_absolute,
        content=content,
        intent=intent,
        context_receipt=guard["context"]["receipt"],
    )


def _source_signature(project_root: str, target_absolute: str, paths: list[str]) -> str:
    try:
        root = resolve_project_root(project_root)
        files: list[tuple[str, str | None]] = []
        for relative in paths:
            normalized = normalize_project_relative_path(relative)
            target = resolve_scoped_path(root, normalized)
            digest = None
            if target.exists():
                sha = hashlib.sha256()
                total = 0
                with target.open("rb") as stream:
                    while chunk := stream.read(64 * 1024):
                        total += len(chunk)
                        if total > _MAX_SOURCE_BYTES:
                            raise AgentOrchestrationError("Chapter Brief 来源超过校验上限，请缩小材料后重新生成。")
                        sha.update(chunk)
                digest = sha.hexdigest()
            files.append((normalized, digest))
        # The same public readers feed draft/repair. This also covers a newly
        # inserted predecessor and changes to the measured author style.
        values = {
            "files": files,
            "previous": previous_chapter_tail(project_root, target_absolute),
            "system": build_generation_system_prompt("", project_root),
            "scene": build_scene_constraint_block(project_root, target_absolute),
        }
        return hashlib.sha256(json.dumps(values, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    except (FsToolError, OSError, ValueError, TypeError) as exc:
        raise AgentOrchestrationError("Chapter Brief 来源无法读取或验证，请重新生成。") from exc
