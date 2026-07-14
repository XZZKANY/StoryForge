"""Evidence and progress helpers for the parallel BookRun runner."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.artifacts.service import create_artifact
from app.domains.book_runs import book_generation as generation


def assert_parallel_preflight(
    source: dict[str, str | None],
    *,
    chapter_count: int,
    chapter_parallelism: int,
    token_budget: int,
    target_word_count: int | None,
    chapter_word_count_min: int,
    chapter_word_count_max: int,
    max_chapter_count: int,
) -> None:
    generation.assert_preflight(
        source,
        chapter_count,
        token_budget,
        target_word_count,
        chapter_word_count_min,
        chapter_word_count_max,
        max_chapter_count=max_chapter_count,
    )
    if chapter_parallelism <= 1:
        raise generation.BookGenerationPreflightError("并发真实 LLM runner 的并发度必须大于 1。")


def blocked_run_artifacts(session: Session, book_run: Any) -> tuple[Any, Any]:
    """为被屏障或评审阻断的并发 runner 留下可审计证据，不伪装为完整导出。"""

    book = session.get(generation.Book, book_run.book_id)
    workspace_id = book.workspace_id if book is not None else None
    content = _blocked_markdown_content(book_run)
    markdown_artifact = create_artifact(
        session,
        ArtifactCreate(
            workspace_id=workspace_id,
            book_id=book_run.book_id,
            artifact_type="book_run_blocked_markdown",
            lineage_key=f"book-run:{book_run.id}:blocked-markdown",
            name="book_run_blocked.md",
            storage_uri=f"memory://book-runs/{book_run.id}/book_run_blocked.md",
            mime_type="text/markdown",
            size_bytes=len(content.encode("utf-8")),
            payload={"content": content},
        ),
    )
    report = {
        "book_run_id": book_run.id,
        "blueprint_id": book_run.blueprint_id,
        "status": book_run.status,
        "current_chapter_index": book_run.current_chapter_index,
        "progress": book_run.progress,
    }
    audit_artifact = create_artifact(
        session,
        ArtifactCreate(
            workspace_id=workspace_id,
            book_id=book_run.book_id,
            artifact_type="book_run_blocked_audit_report",
            lineage_key=f"book-run:{book_run.id}:blocked-audit-report",
            name="blocked_audit_report.json",
            storage_uri=f"memory://book-runs/{book_run.id}/blocked_audit_report.json",
            mime_type="application/json",
            size_bytes=len(str(report).encode("utf-8")),
            payload=report,
        ),
    )
    return markdown_artifact, audit_artifact


def _blocked_markdown_content(book_run: Any) -> str:
    progress = book_run.progress if isinstance(book_run.progress, dict) else {}
    conflict = progress.get("consistency_conflict") if isinstance(progress.get("consistency_conflict"), dict) else {}
    lines = [
        "---",
        f"book_run_id: {book_run.id}",
        f"blueprint_id: {book_run.blueprint_id}",
        f"status: {book_run.status}",
        "---",
        "",
        "# BookRun 阻断证据",
        "",
        f"- 当前章节：{book_run.current_chapter_index}",
        f"- 完成章节数：{len(progress.get('completed_chapters') or [])}",
    ]
    if conflict:
        lines.append(f"- 一致性冲突：{conflict.get('chapter_index')}")
    return "\n".join(lines).strip() + "\n"


def parallel_progress(
    session: Session,
    progress: dict[str, object],
    *,
    book_run_id: int,
    blueprint_id: int,
    chapter_extras: dict[int, dict[str, object]],
    context_cache_metrics: dict[str, object],
    db_query_metrics: dict[str, object],
    source: dict[str, str | None],
) -> dict[str, object]:
    next_progress = dict(progress)
    completed = []
    for item in list(next_progress.get("completed_chapters") or []):
        chapter_progress = dict(item)
        chapter_index = int(chapter_progress.get("chapter_index") or 0)
        chapter_progress.update(chapter_extras.get(chapter_index, {}))
        completed.append(chapter_progress)
    next_progress["completed_chapters"] = completed
    metrics = dict(next_progress.get("integration_metrics") or {})
    metrics.update(_parallel_observed_metrics(session, book_run_id, blueprint_id, completed))
    metrics.update(context_cache_metrics)
    metrics.update(db_query_metrics)
    next_progress["integration_metrics"] = metrics
    next_progress["real_llm_smoke"] = {
        "provider_name": generation.required_env(source, "STORYFORGE_LLM_PROVIDER"),
        "model_name": generation.required_env(source, "STORYFORGE_LLM_MODEL"),
        "chapter_count": len(completed),
        "runner": "phase9b_parallel_workflow",
    }
    return next_progress


def context_cache_metrics(snapshot: Any) -> dict[str, object]:
    metrics: dict[str, object] = {
        "context_cache_hits": snapshot.hits,
        "context_cache_misses": snapshot.misses,
        "context_cache_observation_scope": "book_context_get_book_context",
    }
    if snapshot.hit_rate is not None:
        metrics["context_cache_hit_rate"] = snapshot.hit_rate
    return metrics


def _parallel_observed_metrics(
    session: Session,
    book_run_id: int,
    blueprint_id: int,
    completed_chapters: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "memory_recall_budget_used": generation.direct_memory_recall_budget_used(completed_chapters),
        "arc_completion_rate": generation.arc_completion_rate(session, blueprint_id),
        "chapter_generation_time_p50": generation.chapter_generation_time_p50(completed_chapters),
        "memory_recall_budget_scope": "phase9b_parallel_story_memory_recall",
        "book_run_id": book_run_id,
    }
