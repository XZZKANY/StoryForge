from __future__ import annotations

from prometheus_client import Counter
from prometheus_fastapi_instrumentator import Instrumentator

judge_calls_total = Counter(
    "judge_calls_total",
    "Total judge issue creation calls",
)

repair_patches_total = Counter(
    "repair_patches_total",
    "Total repair patch creation calls",
)

batch_refinery_jobs_total = Counter(
    "batch_refinery_jobs_total",
    "Total batch refinery job submissions",
)

continuity_conflicts_total = Counter(
    "continuity_conflicts_total",
    "Total continuity edge constraint conflicts detected",
)

book_generation_failure_count_total = Counter(
    "book_generation_failure_count_total",
    "Total failed book generation chapters",
)

book_generation_cost_cny_total = Counter(
    "book_generation_cost_cny_total",
    "Total estimated CNY cost emitted by book generation chapters",
)


def observe_book_generation_chapter(
    *,
    judge_call_count: int,
    repair_patch_count: int,
    cost_cny_estimated: float,
) -> None:
    """Record low-cardinality Prometheus counters for one generated chapter."""

    judge_calls_total.inc(max(0, int(judge_call_count)))
    repair_patches_total.inc(max(0, int(repair_patch_count)))
    book_generation_cost_cny_total.inc(max(0.0, float(cost_cny_estimated)))


def observe_book_generation_failure() -> None:
    """Record a failed book generation chapter without exposing run identifiers."""

    book_generation_failure_count_total.inc()


def setup_metrics(app):
    Instrumentator(
        should_group_status_codes=False,
        excluded_handlers=["/health/live", "/health/ready", "/metrics"],
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
