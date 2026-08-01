from __future__ import annotations

from typing import Any

from app.domains.agent_runs import fs_tools, serial_plan_update
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.collapse_scan import collapse_scan
from app.domains.agent_runs.consistency_scan import consistency_scan
from app.domains.agent_runs.cross_chapter import cross_chapter_review
from app.domains.agent_runs.deep_consistency import deep_consistency_review
from app.domains.agent_runs.entity_budget_scan import entity_budget_scan
from app.domains.agent_runs.promise_scan import DEFAULT_STALE_AFTER_CHAPTERS, promise_check
from app.domains.agent_runs.prose_scan import prose_static_scan
from app.domains.agent_runs.tools.execution import ToolExecutionContext, ToolHandler, ToolResult
from app.domains.agent_runs.tools.runtime_arguments import required_string as _required_string
from app.domains.agent_runs.trace import AgentToolTrace


def _with_canon_surface_forms(project_root: str, terms: list[str]) -> list[str]:
    """把 canon 实体的本名与别名补进检索词。

    称谓一致性正是这把工具最该抓的东西，而别名只存在于 canon.json 里——模型不主动把
    「老陈」「默哥」列进 terms 就永远查不到，等于把「查不查得到别名」押在模型的记性上。
    作者传入的词序在前（`consistency_scan` 有 30 词上限，先来先得），canon 补在后面。
    """

    from app.domains.agent_runs import canon_rebuild, canon_store

    try:
        canon = canon_store.read_canon(project_root)
    except fs_tools.FsToolError:
        return terms
    merged = list(terms)
    seen = {term.strip() for term in terms}
    for entity in canon.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        for surface in canon_rebuild.entity_surface_forms(entity):
            if surface and surface not in seen:
                seen.add(surface)
                merged.append(surface)
    return merged


class ProjectChecksRuntimeMixin:
    def _project_check_tool_handlers(self) -> dict[str, ToolHandler]:
        return {
            "project.consistency": self._project_consistency,
            "project.prose_check": self._project_prose_check,
            "project.collapse_check": self._project_collapse_check,
            "project.entity_budget_check": self._project_entity_budget_check,
            "project.promise_check": self._project_promise_check,
            "project.cross_chapter_check": self._project_cross_chapter_check,
            "project.deep_consistency": self._project_deep_consistency,
            "project.plan_update": self._project_plan_update,
        }

    def _project_consistency(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        terms_raw = payload.get("terms")
        terms = (
            [term for term in terms_raw if isinstance(term, str) and term.strip()]
            if isinstance(terms_raw, list)
            else []
        )
        terms = _with_canon_surface_forms(project_root, terms)
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

    def _project_promise_check(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        stale_after_chapters = payload.get("stale_after_chapters", DEFAULT_STALE_AFTER_CHAPTERS)
        if (
            not isinstance(stale_after_chapters, int)
            or isinstance(stale_after_chapters, bool)
            or stale_after_chapters < 1
        ):
            raise fs_tools.FsToolError("stale_after_chapters 必须是正整数。")

        output = promise_check(project_root, stale_after_chapters=stale_after_chapters)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.promise_check",
                status="completed",
                input_summary={"stale_after_chapters": stale_after_chapters},
                output_summary={
                    "current_chapter": output["current_chapter"],
                    "promise_count": output["promise_count"],
                    "conflict_count": output["conflict_count"],
                    "advisory_count": output["advisory_count"],
                },
            ),
        )

    def _project_plan_update(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        chapters_raw = payload.get("chapters")
        if chapters_raw is not None and not isinstance(chapters_raw, list):
            raise fs_tools.FsToolError("chapters 必须是数组。")
        arcs_raw = payload.get("arcs")
        if arcs_raw is not None and not isinstance(arcs_raw, list):
            raise fs_tools.FsToolError("arcs 必须是数组。")
        remove_raw = payload.get("remove_ordinals")
        if remove_raw is not None and not isinstance(remove_raw, list):
            raise fs_tools.FsToolError("remove_ordinals 必须是数组。")
        if not chapters_raw and not remove_raw and arcs_raw is None and not any(
            key in payload for key in ("premise", "chapter_word_count_min", "chapter_word_count_max")
        ):
            raise fs_tools.FsToolError("没有任何要更新的内容：至少传 chapters、arcs、remove_ordinals 或计划头字段之一。")

        output = serial_plan_update.apply_plan_update(
            project_root,
            chapters=[item for item in (chapters_raw or []) if isinstance(item, dict)],
            premise=_optional_string(payload.get("premise")),
            chapter_word_count_min=payload.get("chapter_word_count_min"),
            chapter_word_count_max=payload.get("chapter_word_count_max"),
            arcs=[item for item in arcs_raw if isinstance(item, dict)] if arcs_raw is not None else None,
            remove_ordinals=[item for item in (remove_raw or []) if isinstance(item, int)],
        )
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.plan_update",
                status="completed",
                input_summary={
                    "chapter_count": len(chapters_raw or []),
                    "remove_count": len(remove_raw or []),
                },
                output_summary={
                    "planned_total": output["planned_total"],
                    "next_ordinal": output["next_ordinal"],
                    "created_count": output["created_count"],
                    "updated_count": output["updated_count"],
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

    def _project_cross_chapter_check(self, _context: ToolExecutionContext, payload: dict[str, Any]) -> ToolResult:
        project_root = _required_string(payload, "project_root")
        paths_raw = payload.get("paths")
        if not isinstance(paths_raw, list):
            raise fs_tools.FsToolError("paths 必须是字符串数组（至少两个章节路径）。")
        paths = [item for item in paths_raw if isinstance(item, str) and item.strip()]
        focus = _optional_string(payload.get("focus"))

        output = cross_chapter_review(project_root, paths, focus=focus)
        return ToolResult(
            status="completed",
            output=output,
            trace=AgentToolTrace(
                tool_name="project.cross_chapter_check",
                status="completed",
                input_summary={
                    "paths": [item["path"] for item in output["chapters"]],
                    "focus": focus,
                },
                output_summary={
                    "chapter_count": output["chapter_count"],
                    "finding_count": output["finding_count"],
                    "model": output["model"],
                },
            ),
        )
