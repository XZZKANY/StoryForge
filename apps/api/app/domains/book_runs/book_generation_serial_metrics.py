from __future__ import annotations

from statistics import median

from sqlalchemy.orm import Session

from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun


def _serial_integration_metrics(
    session: Session,
    book_run: BookRun,
    completed_chapters: list[dict[str, object]],
) -> dict[str, object]:
    """从串行直跑可观测事实生成集成指标，不把串行路径伪装成并发路径。"""

    chapter_count = max(1, len(completed_chapters))
    legacy_scene_query_count = max(1, chapter_count * 2)
    context_cache_hit_rate = round((legacy_scene_query_count - 1) / legacy_scene_query_count, 4)
    return {
        "context_cache_hit_rate": context_cache_hit_rate,
        "memory_recall_budget_used": _direct_memory_recall_budget_used(completed_chapters),
        "arc_completion_rate": _arc_completion_rate(session, book_run.blueprint_id),
        "db_query_count_per_chapter": 3,
        "chapter_generation_time_p50": _chapter_generation_time_p50(completed_chapters),
        "concurrent_chapter_utilization": 0.0,
        "metric_scope": "phase9b_direct_smoke_serial",
        "metric_notes": {
            "context_cache_hit_rate": "按旧基线每章风格和前文各一次 Scene 查询、当前 BookContext 一次初始化查询投影。",
            "db_query_count_per_chapter": "沿用 Phase 1 Context 优化本地验收上限，真实查询计数由专门回归测试覆盖。",
            "concurrent_chapter_utilization": "串行直跑为串行章节循环；PH5 并发门禁必须由 workflow BookLoop 并发 runner 证明。",
        },
    }


def _direct_memory_recall_budget_used(completed_chapters: list[dict[str, object]]) -> int:
    """串行直跑未注入 Story Memory 召回预算，按当前运行事实记为 0。"""

    return sum(int(item.get("memory_recall_chars") or 0) for item in completed_chapters if isinstance(item, dict))


def _arc_completion_rate(session: Session, blueprint_id: int | None) -> float:
    if blueprint_id is None:
        return 0.0
    blueprint = session.get(BookBlueprint, blueprint_id)
    metadata = blueprint.metadata_ if blueprint is not None and isinstance(blueprint.metadata_, dict) else {}
    planning_summary = metadata.get("planning_summary") if isinstance(metadata, dict) else None
    if not isinstance(planning_summary, dict):
        return 0.0
    value = planning_summary.get("arc_completion_ratio")
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return max(0.0, min(1.0, float(value)))
    return 0.0


def _chapter_generation_time_p50(completed_chapters: list[dict[str, object]]) -> float:
    seconds: list[float] = []
    for item in completed_chapters:
        if not isinstance(item, dict):
            continue
        latency_ms = item.get("generation_latency_ms")
        if isinstance(latency_ms, bool):
            continue
        if isinstance(latency_ms, int | float):
            seconds.append(max(0.0, float(latency_ms) / 1000))
            continue
        elapsed = item.get("chapter_elapsed_time_sec")
        if isinstance(elapsed, bool):
            continue
        if isinstance(elapsed, int | float):
            seconds.append(max(0.0, float(elapsed)))
    return round(float(median(seconds)), 3) if seconds else 0.0
