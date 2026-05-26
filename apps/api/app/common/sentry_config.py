from __future__ import annotations

import os

from fastapi import HTTPException


def init_sentry() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("STORYFORGE_ENV", "development"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        integrations=[
            FastApiIntegration(),
            SqlalchemyIntegration(),
        ],
        before_send=_before_send,
    )


def _before_send(event: dict, hint: dict) -> dict | None:
    exc_info = hint.get("exc_info")
    if exc_info is None:
        return event

    exc = exc_info[1]
    if isinstance(exc, HTTPException) and exc.status_code < 500:
        return None

    from app.common.exceptions import DomainError

    if isinstance(exc, DomainError):
        return None

    return event
