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


def setup_metrics(app):
    Instrumentator(
        should_group_status_codes=False,
        excluded_handlers=["/health/live", "/health/ready", "/metrics"],
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
