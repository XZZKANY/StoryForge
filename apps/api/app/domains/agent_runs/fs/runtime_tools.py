from __future__ import annotations

import unicodedata
from typing import Any

from sqlalchemy import select

from app.domains.agent_runs import fs_tools
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.fs.knowledge_proposals import (
    KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
    build_knowledge_proposal_group,
)
from app.domains.agent_runs.fs.project_knowledge import (
    project_knowledge_candidates as fs_tools_project_knowledge_candidates,
)
from app.domains.agent_runs.fs.project_knowledge import (
    project_knowledge_entry_index as fs_tools_project_knowledge_entry_index,
)
from app.domains.agent_runs.fs.project_knowledge import (
    project_knowledge_read as fs_tools_project_knowledge_read,
)
from app.domains.agent_runs.fs.project_knowledge import (
    project_knowledge_search as fs_tools_project_knowledge_search,
)
from app.domains.agent_runs.intent import detect_intent as _detect_intent
from app.domains.agent_runs.intent import role_hints as _role_hints
from app.domains.agent_runs.intent import role_mentions as _role_mentions
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    llm_context_snapshot_to_prompt_context_bundle,
    llm_context_snapshot_trace_summary,
)
from app.domains.agent_runs.models import AgentArtifact
from app.domains.agent_runs.tools import ToolArtifact, ToolExecutionContext, ToolHandler, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import fs_int_arg as _fs_int_arg
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.ide.review_skills import review_context_summary


def _knowledge_source_counts(entries: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in entries:
        source_type = entry.get("source_type")
        if isinstance(source_type, str):
            counts[source_type] = counts.get(source_type, 0) + 1
    return counts


def _normalized_knowledge_title(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


class FsRuntimeToolsMixin:
    def _fs_tool_handlers(self) -> dict[str, ToolHandler]:
        return {
            "context.load": self._context_load,
            "fs.list": self._fs_list,
            "fs.read": self._fs_read,
            "fs.search": self._fs_search,
            "project.knowledge": self._project_knowledge,
            "knowledge.propose": self._knowledge_propose,
        }

    def _knowledge_propose(self, context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        existing_artifact_id = context.session.scalar(
            select(AgentArtifact.id)
            .where(
                AgentArtifact.run_id == context.run.id,
                AgentArtifact.kind == KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
            )
            .limit(1)
        )
        if context.args.get("_knowledge_proposal_group_created") is True or existing_artifact_id is not None:
            raise fs_tools.FsToolError("每个 AgentRun 最多生成一组 Project Knowledge 提议。")
        group = build_knowledge_proposal_group(_required_string(payload, "project_root"), payload)
        context.args["_knowledge_proposal_group_created"] = True
        entry_index = fs_tools_project_knowledge_entry_index(_required_string(payload, "project_root"))
        known_fingerprints = {
            indexed.entry.claim_fingerprint
            for indexed in entry_index.entries
        }
        for proposal in group["proposals"]:
            if proposal["operation"] not in {"create", "migrate"}:
                continue
            conflicts = [
                indexed
                for indexed in entry_index.entries
                if indexed.entry.kind == proposal["kind"]
                and _normalized_knowledge_title(indexed.entry.title)
                == _normalized_knowledge_title(proposal["title"])
                and indexed.entry.claim_fingerprint != proposal["claim_fingerprint"]
            ]
            if conflicts:
                target = conflicts[0].relative_path
                proposal["operation"] = "conflict"
                proposal["target_path"] = target
                proposal["related_knowledge_ids"] = [
                    indexed.entry.id for indexed in conflicts if indexed.relative_path == target
                ]
        project_artifacts = context.session.scalars(
            select(AgentArtifact).where(AgentArtifact.kind == KNOWLEDGE_PROPOSAL_ARTIFACT_KIND)
        )
        for artifact in project_artifacts:
            artifact_payload = artifact.payload if isinstance(artifact.payload, dict) else {}
            if artifact_payload.get("project_fingerprint") != group["project_fingerprint"]:
                continue
            artifact_proposals = artifact_payload.get("proposals")
            if isinstance(artifact_proposals, list):
                known_fingerprints.update(
                    item["claim_fingerprint"]
                    for item in artifact_proposals
                    if isinstance(item, dict) and isinstance(item.get("claim_fingerprint"), str)
                )
        proposals = [
            item for item in group["proposals"] if item["claim_fingerprint"] not in known_fingerprints
        ]
        suppressed_count = len(group["proposals"]) - len(proposals)
        group["proposals"] = proposals
        artifacts = (
            (
                ToolArtifact(kind=KNOWLEDGE_PROPOSAL_ARTIFACT_KIND, payload=group, requires_confirmation=False),
            )
            if proposals
            else ()
        )
        return ToolResult(
            status="completed",
            output={
                "proposal_group_id": group["proposal_group_id"],
                "proposal_count": len(proposals),
                "suppressed_count": suppressed_count,
                "targets": [item["target_path"] for item in proposals],
                "status": "pending_author_review" if proposals else "duplicate_suppressed",
            },
            trace=AgentToolTrace(
                tool_name="knowledge.propose",
                status="completed",
                input_summary={"proposal_count": len(proposals)},
                output_summary={
                    "proposal_count": len(proposals),
                    "suppressed_count": suppressed_count,
                    "target_paths": [item["target_path"] for item in proposals],
                },
            ),
            artifacts=artifacts,
        )

    def _project_knowledge(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        action = _required_string(payload, "action")
        if action == "list":
            discovered = fs_tools_project_knowledge_candidates(project_root, max_entries=201)
            entries = discovered[:200]
            output = {"action": action, "entries": entries, "truncated": len(discovered) > 200, "warnings": []}
            summary = {
                "action": action,
                "candidate_count": len(entries),
                "source_counts": _knowledge_source_counts(entries),
                "truncated": output["truncated"],
                "warning_count": 0,
            }
        elif action == "read":
            output = fs_tools_project_knowledge_read(
                project_root,
                _required_string(payload, "path"),
                offset=_fs_int_arg(payload, "offset", 0),
                limit=_fs_int_arg(payload, "limit", 20_000),
            )
            output["action"] = action
            summary = {
                "action": action,
                "path": output["path"],
                "source_type": output["source_type"],
                "returned_chars": output["returned_chars"],
                "truncated": output["truncated"],
                "redacted": output["redacted"],
                "warning_count": len(output["warnings"]),
            }
        elif action == "search":
            output = fs_tools_project_knowledge_search(
                project_root,
                _required_string(payload, "query"),
                use_regex=payload.get("use_regex") is True,
            )
            output["action"] = action
            summary = {
                "action": action,
                "match_count": len(output["matches"]),
                "scanned_files": output["scanned_files"],
                "truncated": output["truncated"],
                "redacted": output["redacted"],
                "warning_count": len(output["warnings"]),
            }
        else:
            raise fs_tools.FsToolError(f"不支持的 Project Knowledge action：{action}")
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.knowledge",
                status="completed",
                input_summary={"action": action},
                output_summary=summary,
            ),
        )

    def _fs_list(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        subpath = _optional_string(payload.get("subpath"))
        output = fs_tools.fs_list(project_root, subpath)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="fs.list",
                status="completed",
                input_summary={"subpath": subpath},
                output_summary={"entry_count": len(output["entries"]), "truncated": output["truncated"]},
            ),
        )

    def _fs_read(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        path = _required_string(payload, "path")
        output = fs_tools.fs_read(
            project_root,
            path,
            offset=_fs_int_arg(payload, "offset", 0),
            limit=_fs_int_arg(payload, "limit", 20_000),
        )
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="fs.read",
                status="completed",
                input_summary={"path": path},
                output_summary={
                    "path": output["path"],
                    "returned_chars": output["returned_chars"],
                    "truncated": output["truncated"],
                },
            ),
        )

    def _fs_search(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        query = _required_string(payload, "query")
        glob = _optional_string(payload.get("glob")) or "*.md"
        output = fs_tools.fs_search(
            project_root,
            query,
            glob=glob,
            use_regex=payload.get("use_regex") is True,
        )
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="fs.search",
                status="completed",
                input_summary={"query": query[:200], "glob": glob},
                output_summary={"match_count": len(output["matches"]), "truncated": output["truncated"]},
            ),
        )

    def _context_load(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        file_path = _required_string(payload, "file_path")
        content = _required_string(payload, "content")
        context_bundle = payload.get("context_bundle") if isinstance(payload.get("context_bundle"), dict) else None
        summary = review_context_summary(context_bundle)
        llm_context_snapshot = build_llm_context_snapshot(
            run_state=_context.run,
            intent=_optional_string(payload.get("_agent_intent"))
            or _detect_intent(_context.user_message, _context.args, _context.args.get("intent")),
            user_message=_context.user_message,
            file_path=file_path,
            content=content,
            context_bundle=context_bundle,
            role_hints=_role_hints(_context.args),
            role_mentions=_role_mentions(_context.args),
            event_history=_context.run.events,
            artifacts=_context.run.artifacts,
        )
        llm_context_summary = llm_context_snapshot_trace_summary(llm_context_snapshot)
        llm_prompt_context_bundle = llm_context_snapshot_to_prompt_context_bundle(llm_context_snapshot)
        output = {
            "file_path": file_path,
            "content": content,
            "context_bundle": context_bundle,
            "context_summary": summary,
            "llm_context_snapshot": llm_context_snapshot,
            "llm_prompt_context_bundle": llm_prompt_context_bundle,
        }
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="context.load",
                status="completed",
                input_summary={"file_path": file_path, "content_chars": len(content)},
                output_summary={
                    "context_file_count": summary["file_count"],
                    "context_kinds": summary["kinds"],
                    "llm_context": llm_context_summary,
                },
            ),
        )
