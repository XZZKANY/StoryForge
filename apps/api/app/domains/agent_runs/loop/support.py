from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs.tools import loop_patch_tool_specs
from app.domains.assistant import service as assistant_service

_PATCH_TOOLS = tuple(spec.name for spec in loop_patch_tool_specs())


_TOOL_RESULT_MAX_CHARS = 24_000


_HISTORY_MAX_MESSAGES = 12


_HISTORY_MESSAGE_MAX_CHARS = 4_000


_REVIEW_FEEDBACK_MAX_ISSUES = 20


_REVIEW_FEEDBACK_ISSUE_KEYS = ("id", "category", "severity", "code", "message", "suggested_action")


def _serialize_tool_output(output: dict[str, Any]) -> str:
    text = json.dumps(output, ensure_ascii=False)
    if len(text) > _TOOL_RESULT_MAX_CHARS:
        return text[:_TOOL_RESULT_MAX_CHARS] + "…[结果过长已截断]"
    return text


def _merge_cost_breakdown(
    current: dict[str, Any],
    incoming: object,
    *,
    prompt_tokens: int,
    completion_tokens: int,
    token_usage_source: str,
) -> dict[str, Any]:
    if not isinstance(incoming, dict):
        return current
    merged = dict(current)
    for key in ("input_cny", "output_cny", "total_cny"):
        value = incoming.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            merged[key] = float(merged.get(key) or 0.0) + float(value)
    for key in (
        "currency",
        "input_cny_per_m_tokens",
        "output_cny_per_m_tokens",
        "cache_hit_input_cny_per_m_tokens",
    ):
        if key in incoming:
            merged[key] = incoming[key]
    merged["prompt_tokens"] = prompt_tokens
    merged["completion_tokens"] = completion_tokens
    merged["source"] = token_usage_source
    return merged


def _parse_tool_arguments(raw: str) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("工具参数必须是 JSON 对象。")
    return parsed


def _history_messages(session: Session, assistant_session_id: int) -> list[dict[str, Any]]:
    record = assistant_service.get_assistant_session(session, assistant_session_id)
    history: list[dict[str, Any]] = []
    for message in record.messages[-_HISTORY_MAX_MESSAGES:]:
        if message.role not in ("user", "assistant"):
            continue
        history.append({"role": message.role, "content": message.content[:_HISTORY_MESSAGE_MAX_CHARS]})
    return history


def _tool_output_summary(registry_name: str, output: dict[str, Any]) -> dict[str, Any]:
    if registry_name == "fs.list":
        return {"entry_count": len(output.get("entries") or []), "truncated": output.get("truncated")}
    if registry_name == "fs.read":
        return {
            "path": output.get("path"),
            "returned_chars": output.get("returned_chars"),
            "truncated": output.get("truncated"),
        }
    if registry_name == "project.consistency":
        return {
            "scanned_files": output.get("scanned_files"),
            "term_count": len(output.get("term_occurrences") or []),
            "time_marker_count": len(output.get("time_markers") or []),
            "repeated_clause_count": len(output.get("repeated_clauses") or []),
        }
    if registry_name == "project.prose_check":
        return {
            "path": output.get("path"),
            "issue_count": output.get("issue_count"),
            "dimension_count": len(output.get("dimension_counts") or {}),
        }
    if registry_name == "project.collapse_check":
        verdict = output.get("verdict") if isinstance(output.get("verdict"), dict) else {}
        return {
            "path": output.get("path"),
            "verdict": verdict.get("status"),
            "issue_count": len(verdict.get("issues") or []),
        }
    if registry_name == "project.entity_budget_check":
        verdict = output.get("verdict") if isinstance(output.get("verdict"), dict) else {}
        return {
            "path": output.get("path"),
            "chapter": output.get("chapter"),
            "verdict": verdict.get("status"),
            "issue_count": len(verdict.get("issues") or []),
        }
    if registry_name == "project.deep_consistency":
        return {
            "path": output.get("path"),
            "issue_count": output.get("issue_count"),
            "bible_file_count": len(output.get("bible_files") or []),
        }
    if registry_name == "project.canon":
        return {
            "entity_count": output.get("entity_count"),
            "conflict_count": output.get("conflict_count"),
            "advisory_count": output.get("advisory_count"),
        }
    if registry_name == "project.canon_delta":
        proposals = output.get("proposals") if isinstance(output.get("proposals"), dict) else {}
        return {
            "new_entity_count": len(proposals.get("new_entities") or []),
            "known_entity_count": len(proposals.get("known_entities") or []),
            "alias_conflict_count": len(output.get("alias_conflicts") or []),
            "new_conflict_count": len(output.get("new_conflicts") or []),
            "new_advisory_count": len(output.get("new_advisories") or []),
        }
    if registry_name == "project.hooks_delta":
        return {
            "new_hook_count": len(output.get("new_hooks") or []),
            "duplicate_count": len(output.get("duplicates") or []),
            "pattern_hit_count": len(output.get("pattern_hits") or []),
        }
    if registry_name == "file.review":
        report = output.get("review_report") if isinstance(output.get("review_report"), dict) else {}
        return {
            "file_path": report.get("file_path"),
            "issue_count": len(report.get("issues") or []),
            "mode": report.get("mode"),
        }
    if registry_name == "project.trim_prose":
        return {
            "file_path": output.get("file_path"),
            "original_chars": output.get("trim_audit", {}).get("original_chars"),
            "compressed_chars": output.get("trim_audit", {}).get("compressed_chars"),
            "compression_percent": output.get("trim_audit", {}).get("actual_percent"),
            "target_percent": output.get("trim_audit", {}).get("target_percent"),
            "model": output.get("model"),
        }
    if registry_name in _PATCH_TOOLS:
        patch = output.get("proposed_patch") if isinstance(output.get("proposed_patch"), dict) else {}
        return {
            "file_path": output.get("file_path"),
            "after_chars": len(str(output.get("after") or "")),
            "model": output.get("model"),
            "patch_id": patch.get("id"),
        }
    return {
        "match_count": len(output.get("matches") or []),
        "scanned_files": output.get("scanned_files"),
        "truncated": output.get("truncated"),
    }


def _review_feedback(output: dict[str, Any]) -> dict[str, Any]:
    """给模型的审稿反馈只保留结构化 issue 要点，不回灌整包 report（含 traces、上下文摘要）。"""

    report = output.get("review_report") if isinstance(output.get("review_report"), dict) else {}
    issues = [issue for issue in (report.get("issues") or []) if isinstance(issue, dict)]
    trimmed = [
        {key: issue.get(key) for key in _REVIEW_FEEDBACK_ISSUE_KEYS if issue.get(key) is not None}
        for issue in issues[:_REVIEW_FEEDBACK_MAX_ISSUES]
    ]
    return {
        "file_path": report.get("file_path"),
        "mode": report.get("mode"),
        "issue_count": len(issues),
        "issues": trimmed,
        "issues_truncated": len(issues) > _REVIEW_FEEDBACK_MAX_ISSUES,
        "suggested_actions": report.get("suggested_actions"),
    }


def _revise_feedback(output: dict[str, Any]) -> dict[str, Any]:
    """修订反馈不携带 before/after 全文：既省预算，也防模型把未确认补丁当已写回事实。"""

    return {
        "status": "proposed_patch_created",
        "file_path": output.get("file_path"),
        "summary": output.get("summary"),
        "applied_scope": output.get("applied_scope"),
        "note": "修订补丁已生成，等待作者在界面确认后才会写盘；不要假设已写回。",
    }


serialize_tool_output = _serialize_tool_output
merge_cost_breakdown = _merge_cost_breakdown
parse_tool_arguments = _parse_tool_arguments
history_messages = _history_messages
tool_output_summary = _tool_output_summary
review_feedback = _review_feedback
revise_feedback = _revise_feedback
