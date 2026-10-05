"""Fingerprint only files actually named by the saved request/tool transcript."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.common.author_voice import RELATIVE_PATH as AUTHOR_INSTRUCTIONS_PATH
from app.domains.agent_runs.loop.generation_recovery import generation_sources_unchanged
from app.domains.agent_runs.tools import list_loop_tool_specs, llm_tool_name
from app.platform.ai_sdk import RuntimeCheckpoint


def file_digest(path: Path) -> str | None:
    if not path.exists():
        return None
    if not path.is_file():
        raise ValueError("recovery_source_not_file")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def source_versions(checkpoint: RuntimeCheckpoint, message: dict[str, Any]) -> dict[str, Any]:
    args = message.get("args") or {}
    root = Path(str(args.get("project_path") or "")).resolve(strict=True)
    paths = [args.get("file_path"), AUTHOR_INSTRUCTIONS_PATH]
    bundle = args.get("context_bundle")
    if isinstance(bundle, dict) and isinstance(bundle.get("files"), list):
        paths.extend(item.get("relative_path") or item.get("path")
                     for item in bundle["files"] if isinstance(item, dict) and item.get("excerpt"))
    tracked = {llm_tool_name(s.name) for s in list_loop_tool_specs()
               if s.loop_input_mode in {"existing_file", "new_file"} or s.name == "fs.read"}
    for item in checkpoint.messages:
        for call in item.tool_calls:
            if call.name not in tracked:
                continue
            try:
                arguments = json.loads(call.arguments_json)
            except (ValueError, TypeError):
                continue
            if isinstance(arguments, dict):
                paths.append(arguments.get("path"))
    files = {}
    for value in paths:
        if not isinstance(value, str) or not value:
            continue
        path = (root / value).resolve()
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError:
            # Never inspect paths outside the trusted project, even in checkpoint input.
            continue
        # Keep the requested alias as well as its resolved target. Saving only
        # the latter would miss a symlink/junction being removed or retargeted.
        files[value] = {"path": relative, "sha256": file_digest(path)}
    return {"schema_version": 1, "project_root": str(root), "files": files}


def sources_unchanged(snapshot: dict[str, Any], message: dict[str, Any]) -> bool:
    try:
        if snapshot.get("schema_version") != 1 or not isinstance(snapshot.get("files"), dict):
            return False
        root = Path(message["args"]["project_path"]).resolve(strict=True)
        if not root.is_dir() or str(root) != snapshot["project_root"]:
            return False
        for requested, reference in snapshot["files"].items():
            if not isinstance(reference, dict):
                return False  # Older fingerprints cannot prove alias identity.
            path = (root / requested).resolve()
            if path.relative_to(root).as_posix() != reference["path"]:
                return False
            if file_digest(path) != reference["sha256"]:
                return False
        return generation_sources_unchanged(
            snapshot.get("generation_receipts", []), root, user_message=message.get("user_message") or "续写",
        )
    except (OSError, ValueError, TypeError, KeyError):
        return False
