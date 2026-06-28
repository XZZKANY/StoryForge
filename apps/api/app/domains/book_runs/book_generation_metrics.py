"""Metrics helpers for book generation evidence summaries.

这些函数从 book_generation.py 提取，用于生成集成指标和证据摘要。
提取原则：纯函数、无外部状态依赖、可独立测试。
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

MARKDOWN_CHAPTER_HEADING_RE = re.compile(r"^##\s+第\s*(\d+)\s*章\b")


def _float_value(value: object) -> float:
    """Extract float from arbitrary value, treating bool as 0.0."""
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return float(value)
    return 0.0


def _artifact_payload_sha256(artifact: object) -> str:
    """Compute SHA256 hash of artifact payload."""
    source = _artifact_text(artifact)
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _artifact_text(artifact: object) -> str:
    """Extract text content from artifact payload."""
    payload = getattr(artifact, "payload", None)
    if isinstance(payload, dict) and isinstance(payload.get("content"), str):
        return payload["content"]
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _integration_metrics_from_audit_artifact(artifact: object) -> dict[str, object]:
    """Extract integration metrics from audit artifact payload."""
    payload = getattr(artifact, "payload", None)
    if isinstance(payload, dict):
        metrics = payload.get("integration_metrics")
        if isinstance(metrics, dict):
            return dict(metrics)
        quality_summary = payload.get("quality_summary")
        if isinstance(quality_summary, dict):
            metrics = quality_summary.get("integration_metrics")
            if isinstance(metrics, dict):
                return dict(metrics)
    return {}


def _per_chapter_char_counts(book_md_content: str, completed_chapters: list[object]) -> list[dict[str, int | None]]:
    """Compute per-chapter character counts from markdown content."""
    chapters = [_chapter_index(item, index + 1) for index, item in enumerate(completed_chapters)]
    if len(chapters) <= 1:
        return [{"chapter_index": chapters[0] if chapters else 1, "char_count": _body_char_count(book_md_content)}]
    parsed_counts = _markdown_chapter_body_char_counts(book_md_content)
    return [
        {"chapter_index": chapter_index, "char_count": parsed_counts.get(chapter_index, 0)}
        for chapter_index in chapters
    ]


def _markdown_chapter_body_char_counts(content: str) -> dict[int, int]:
    """Parse markdown and compute char count per chapter body."""
    counts: dict[int, int] = {}
    current_chapter: int | None = None
    for line in content.splitlines():
        heading_match = MARKDOWN_CHAPTER_HEADING_RE.match(line.strip())
        if heading_match:
            current_chapter = int(heading_match.group(1))
            counts.setdefault(current_chapter, 0)
            continue
        if current_chapter is None or not line.strip() or line.lstrip().startswith("#"):
            continue
        counts[current_chapter] = counts.get(current_chapter, 0) + len(line)
    return counts


def _chapter_index(item: object, fallback: int) -> int:
    """Extract chapter index from chapter progress item."""
    if isinstance(item, dict) and isinstance(item.get("chapter_index"), int):
        return int(item["chapter_index"])
    return fallback


def _body_char_count(content: str) -> int:
    """Count chars in body content, excluding headings."""
    lines = content.splitlines()
    body_lines = [line for line in lines if line.strip() and not line.lstrip().startswith("#")]
    body = "".join(body_lines) if body_lines else content
    return len(body)


def _chapter_metric(item: object) -> dict[str, object]:
    """Build per-chapter metric dict from progress item."""
    if not isinstance(item, dict):
        return {
            "chapter_index": None,
            "token_usage": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "generation_latency_ms": 0,
            "quality_score": None,
            "quality_issue_count": 0,
            "elapsed_time_sec": 0,
            "repair_rounds": 0,
        }
    issues = item.get("quality_issues")
    issue_count = len(issues) if isinstance(issues, list) else 0
    return {
        "chapter_index": item.get("chapter_index"),
        "token_usage": item.get("token_usage", 0),
        "prompt_tokens": item.get("prompt_tokens", 0),
        "completion_tokens": item.get("completion_tokens", 0),
        "generation_latency_ms": item.get("generation_latency_ms", 0),
        "quality_score": item.get("quality_score"),
        "quality_issue_count": issue_count,
        "elapsed_time_sec": item.get("elapsed_time_sec", 0),
        "repair_rounds": item.get("repair_rounds", 0),
    }


def _sum_chapter_int(chapters: list[object], field_name: str) -> int:
    """Sum integer field across chapter progress items."""
    total = 0
    for item in chapters:
        if isinstance(item, dict):
            value = item.get(field_name)
            if isinstance(value, bool):
                continue
            if isinstance(value, int | float):
                total += int(value)
    return total


def _latency_summary(chapters: list[object]) -> dict[str, int]:
    """Compute latency statistics from chapter progress."""
    latencies = []
    for item in chapters:
        if not isinstance(item, dict):
            continue
        value = item.get("generation_latency_ms")
        if isinstance(value, bool):
            continue
        if isinstance(value, int | float) and value >= 0:
            latencies.append(int(value))
    total = sum(latencies)
    return {
        "total_latency_ms": total,
        "avg_latency_ms": round(total / len(latencies)) if latencies else 0,
        "max_latency_ms": max(latencies) if latencies else 0,
    }


def _failure_count(chapters: list[object]) -> int:
    """Count failed chapters in progress."""
    count = 0
    for item in chapters:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "").lower()
        if status in {"failed", "error"} or item.get("error_message"):
            count += 1
    return count


def _aggregate_cost_breakdown(chapters: list[object], fallback_total: float) -> dict[str, object]:
    """Aggregate cost breakdown across chapters."""
    input_cny = 0.0
    output_cny = 0.0
    source = "unavailable"
    for item in chapters:
        if not isinstance(item, dict):
            continue
        breakdown = item.get("cost_breakdown")
        if not isinstance(breakdown, dict):
            continue
        input_cny += _float_value(breakdown.get("input_cny"))
        output_cny += _float_value(breakdown.get("output_cny"))
        source = str(breakdown.get("source") or source)
    total = input_cny + output_cny
    if total == 0 and fallback_total:
        total = float(fallback_total)
    return {
        "currency": "CNY",
        "input_cny": input_cny,
        "output_cny": output_cny,
        "total_cny": total,
        "source": source,
    }


def _result_summary(result: object) -> dict[str, object]:
    """Build minimal result summary dict."""
    book_run = result.book_run
    markdown_artifact = result.markdown_artifact
    audit_artifact = result.audit_artifact
    return {
        "book_run_id": book_run.id,
        "status": book_run.status,
        "chapter_count": result.chapter_count,
        "tokens_used": book_run.tokens_used,
        "estimated_cost": book_run.estimated_cost,
        "markdown_artifact_id": markdown_artifact.id,
        "markdown_artifact_name": markdown_artifact.name,
        "audit_artifact_id": audit_artifact.id,
        "audit_artifact_name": audit_artifact.name,
    }


def _evidence_summary(
    result: object,
    *,
    target_word_count: int | None,
    chapter_word_count_min: int,
    chapter_word_count_max: int,
) -> dict[str, object]:
    """生成不包含 provider 私密配置的脱敏证据摘要。"""
    book_run = result.book_run
    markdown_artifact = result.markdown_artifact
    audit_artifact = result.audit_artifact
    progress = getattr(book_run, "progress", None)
    progress = progress if isinstance(progress, dict) else {}
    completed_chapters = progress.get("completed_chapters")
    completed_chapters = completed_chapters if isinstance(completed_chapters, list) else []
    book_md_content = _artifact_text(markdown_artifact)
    cost_breakdown = _aggregate_cost_breakdown(completed_chapters, book_run.estimated_cost)
    latency = _latency_summary(completed_chapters)
    return {
        "mode": "real_llm_smoke",
        "book_run_id": book_run.id,
        "book_run_status": book_run.status,
        "target_chapter_count": result.chapter_count,
        "actual_chapter_count": len(completed_chapters) or result.chapter_count,
        "target_word_count": target_word_count,
        "chapter_word_count_min": chapter_word_count_min,
        "chapter_word_count_max": chapter_word_count_max,
        "tokens_used": book_run.tokens_used,
        "estimated_cost": book_run.estimated_cost,
        "prompt_tokens_used": _sum_chapter_int(completed_chapters, "prompt_tokens"),
        "completion_tokens_used": _sum_chapter_int(completed_chapters, "completion_tokens"),
        "cost_cny_estimated": cost_breakdown["total_cny"],
        "cost_breakdown": cost_breakdown,
        **latency,
        "failure_count": _failure_count(completed_chapters),
        "repair_round_count": _sum_chapter_int(completed_chapters, "repair_rounds"),
        "actual_total_chars": len(book_md_content),
        "per_chapter_char_counts": _per_chapter_char_counts(book_md_content, completed_chapters),
        "markdown_artifact_id": markdown_artifact.id,
        "audit_artifact_id": audit_artifact.id,
        "artifact_hashes": {
            "book_md_sha256": _artifact_payload_sha256(markdown_artifact),
            "audit_report_sha256": _artifact_payload_sha256(audit_artifact),
        },
        "per_chapter_metrics": [_chapter_metric(item) for item in completed_chapters],
        "integration_metrics": _integration_metrics_from_audit_artifact(audit_artifact),
    }
