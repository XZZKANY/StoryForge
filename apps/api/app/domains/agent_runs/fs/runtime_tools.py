from __future__ import annotations

from typing import Any

from app.domains.agent_runs import fs_tools
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.intent import detect_intent as _detect_intent
from app.domains.agent_runs.intent import role_hints as _role_hints
from app.domains.agent_runs.intent import role_mentions as _role_mentions
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    llm_context_snapshot_to_prompt_context_bundle,
    llm_context_snapshot_trace_summary,
)
from app.domains.agent_runs.tooling import ToolExecutionContext, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import fs_int_arg as _fs_int_arg
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.ide.review_skills import review_context_summary


class FsRuntimeToolsMixin:
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
