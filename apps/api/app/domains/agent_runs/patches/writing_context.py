"""Refresh adapter captures at writer dispatch using backend-owned source inputs."""

from __future__ import annotations

from os.path import normcase
from typing import Any

from app.domains.agent_runs.llm_context import build_llm_context_snapshot
from app.domains.agent_runs.tools import ToolExecutionContext
from app.domains.assistant.writing_context import PreparedWritingContext, writing_context_from_snapshot


def prepare_runtime_writing_context(
    context: ToolExecutionContext,
    payload: dict[str, Any],
    *,
    intent: str,
) -> PreparedWritingContext:
    root = payload.get("project_root") or context.args.get("project_path")
    root = root if isinstance(root, str) and root.strip() else None
    payload["project_root"] = root
    original = context.args.get("context_bundle")
    if not isinstance(original, dict):
        original = payload.get("context_bundle")
    previous = payload.get("llm_context_snapshot")
    previous = previous if isinstance(previous, dict) else {}
    bundle = dict(original) if isinstance(original, dict) else {}
    # Fixed adapters can prepare memory/chapter values independently of raw pins.
    for key in ("story_memory", "chapter_context"):
        if key not in bundle and isinstance(previous.get(key), dict):
            bundle[key] = previous[key]
    if not isinstance(original, dict) and isinstance(previous.get("context_files"), list):
        # A retrieval output is not an author request. Re-pinning it would freeze
        # its rank and let an auto-selected file's outside notes survive even
        # after that file loses the next selection. Preserve genuine request
        # sources; loop reads have their own backend handoff below.
        automatic_paths = {
            normcase(str(item.get("relative_path") or ""))
            for item in previous["context_files"]
            if isinstance(item, dict) and item.get("selection_source") == "auto_retrieved"
        }
        bundle["files"] = [
            item
            for item in previous["context_files"]
            if isinstance(item, dict)
            and item.get("selection_source") != "loop_fs_read"
            and normcase(str(item.get("relative_path") or "")) not in automatic_paths
        ]
    bundle.update(project_root=root or "storyforge://llm-context", current_file=payload["file_path"])
    extra = list(context.writing_read_sources) or [
        item
        for item in previous.get("context_files", [])
        if isinstance(item, dict) and item.get("selection_source") == "loop_fs_read"
    ]
    snapshot = build_llm_context_snapshot(
        run_state=context.run,
        intent=intent,
        user_message=context.user_message,
        file_path=str((payload.get("_trace_file_path") if root else None) or payload["file_path"]),
        content=str(payload.get("content") or ""),
        context_bundle=bundle,
        role_hints=previous.get("role_hints"),
        role_mentions=previous.get("role_mentions"),
        # Selected revision issues are already in the scoped instruction. Never
        # recreate the unselected synthetic report as a second writer channel.
        review_report=None if intent == "file.revise" else previous.get("review_report"),
        event_history=context.run.events,
        artifacts=None if intent == "file.revise" else context.run.artifacts,
        extra_context_files=extra,
    )
    payload["llm_context_snapshot"] = snapshot
    prepared = writing_context_from_snapshot(
        snapshot,
        project_root=root,
        file_path=payload["file_path"],
        content=str(payload.get("content") or ""),
        intent=intent,
    )
    payload["llm_prompt_context_bundle"] = prepared.context_bundle.model_dump()
    return prepared
