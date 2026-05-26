from __future__ import annotations

import os


def init_sentry() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return

    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("STORYFORGE_ENV", "development"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
    )


def capture_workflow_exception(
    exc: Exception,
    *,
    workflow_id: str,
    node_id: str,
) -> None:
    try:
        import sentry_sdk

        sentry_sdk.set_tag("workflow_id", workflow_id)
        sentry_sdk.set_tag("node_id", node_id)
        sentry_sdk.capture_exception(exc)
    except Exception:
        pass
