from __future__ import annotations

from typing import Any

from app.domains.agent_runs import fs_tools
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.collapse_scan import collapse_scan
from app.domains.agent_runs.consistency_scan import consistency_scan
from app.domains.agent_runs.deep_consistency import deep_consistency_review
from app.domains.agent_runs.entity_budget_scan import entity_budget_scan
from app.domains.agent_runs.prose_scan import prose_static_scan
from app.domains.agent_runs.tooling import ToolExecutionContext, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.agent_runs.trace import AgentToolTrace


class ProjectChecksRuntimeMixin:
    def _project_consistency(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        terms_raw = payload.get("terms")
        terms = (
            [term for term in terms_raw if isinstance(term, str) and term.strip()]
            if isinstance(terms_raw, list)
            else []
        )
        subpath = _optional_string(payload.get("subpath"))
        glob = _optional_string(payload.get("glob")) or "*.md"
        output = consistency_scan(project_root, terms, subpath=subpath, glob=glob)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.consistency",
                status="completed",
                input_summary={"terms": terms[:10], "subpath": subpath, "glob": glob},
                output_summary={
                    "scanned_files": output["scanned_files"],
                    "term_count": len(output["term_occurrences"]),
                    "time_marker_count": len(output["time_markers"]),
                    "repeated_clause_count": len(output["repeated_clauses"]),
                },
            ),
        )

    def _project_prose_check(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        path = _required_string(payload, "path")
        output = prose_static_scan(project_root, path)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.prose_check",
                status="completed",
                input_summary={"path": path},
                output_summary={
                    "path": output["path"],
                    "issue_count": output["issue_count"],
                    "dimension_count": len(output["dimension_counts"]),
                },
            ),
        )

    def _project_collapse_check(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        path = _required_string(payload, "path")

        beats: list[str] | None = None
        if "beats" in payload:
            beats_raw = payload["beats"]
            if not isinstance(beats_raw, list) or any(not isinstance(item, str) for item in beats_raw):
                raise fs_tools.FsToolError("beats 必须是字符串数组。")
            beats = beats_raw

        optional_strings: dict[str, str | None] = {}
        for key in ("emotion_before", "emotion_after", "irreversible_consequence"):
            if key not in payload:
                optional_strings[key] = None
                continue
            value = payload[key]
            if not isinstance(value, str):
                raise fs_tools.FsToolError(f"{key} 必须是字符串。")
            optional_strings[key] = value

        deletable: bool | None = None
        if "deletable" in payload:
            if not isinstance(payload["deletable"], bool):
                raise fs_tools.FsToolError("deletable 必须是布尔值。")
            deletable = payload["deletable"]

        output = collapse_scan(
            project_root,
            path,
            beats=beats,
            emotion_before=optional_strings["emotion_before"],
            emotion_after=optional_strings["emotion_after"],
            irreversible_consequence=optional_strings["irreversible_consequence"],
            deletable=deletable,
        )
        verdict = output["verdict"]
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.collapse_check",
                status="completed",
                input_summary={"path": path},
                output_summary={
                    "path": output["path"],
                    "verdict": verdict["status"],
                    "issue_count": len(verdict["issues"]),
                },
            ),
        )

    def _project_entity_budget_check(
        self,
        _context: ToolExecutionContext,
        payload: dict[str, Any],
    ) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        path = _required_string(payload, "path")
        scan_args: dict[str, Any] = {}

        for key in (
            "new_key_characters",
            "new_core_locations",
            "new_core_evidence",
            "new_major_reversals",
            "new_mysteries",
            "new_equipment",
        ):
            if key not in payload:
                continue
            value = payload[key]
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise fs_tools.FsToolError(f"{key} 必须是字符串数组。")
            scan_args[key] = value

        for key in (
            "chapter",
            "budget_key_characters",
            "budget_core_locations",
            "budget_core_evidence",
            "budget_major_reversals",
            "budget_new_core_entities_after_chapter_20",
            "budget_new_mysteries_after_chapter_25",
        ):
            if key not in payload:
                continue
            value = payload[key]
            if not isinstance(value, int) or isinstance(value, bool):
                raise fs_tools.FsToolError(f"{key} 必须是整数。")
            scan_args[key] = value

        output = entity_budget_scan(project_root, path, **scan_args)
        verdict = output["verdict"]
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.entity_budget_check",
                status="completed",
                input_summary={"path": path, "chapter": output["chapter"]},
                output_summary={
                    "path": output["path"],
                    "chapter": output["chapter"],
                    "verdict": verdict["status"],
                    "issue_count": len(verdict["issues"]),
                },
            ),
        )

    def _project_deep_consistency(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        path = _required_string(payload, "path")
        bible_paths_raw = payload.get("bible_paths")
        bible_paths = (
            [item for item in bible_paths_raw if isinstance(item, str) and item.strip()]
            if isinstance(bible_paths_raw, list)
            else None
        )
        facts_raw = payload.get("facts")
        facts = (
            [item for item in facts_raw if isinstance(item, str) and item.strip()]
            if isinstance(facts_raw, list)
            else None
        )
        output = deep_consistency_review(project_root, path, bible_paths=bible_paths or None, facts=facts)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.deep_consistency",
                status="completed",
                input_summary={"path": path, "bible_paths": (bible_paths or [])[:10], "fact_count": len(facts or [])},
                output_summary={
                    "path": output["path"],
                    "issue_count": output["issue_count"],
                    "bible_file_count": len(output["bible_files"]),
                },
            ),
        )
