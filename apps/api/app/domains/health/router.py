from __future__ import annotations

from typing import Any

import redis
from fastapi import APIRouter
from sqlalchemy import text

from app.common.redis_cache import _redis_client
from app.db.session import get_engine

router = APIRouter(prefix="/health", tags=["运行状态"])

_CORE_TABLES = ["books", "artifacts", "workspaces"]


@router.get("/live")
def liveness() -> dict[str, str]:
    return {"status": "alive"}


@router.get("/ready")
def readiness() -> dict[str, str | dict[str, Any]]:
    checks: dict[str, Any] = {}
    all_ok = True

    try:
        with get_engine().connect() as conn:
            count = conn.execute(
                text(
                    "SELECT count(*) FROM pg_tables "
                    "WHERE schemaname = 'public' "
                    "AND tablename = ANY(:tables)"
                ),
                {"tables": _CORE_TABLES},
            ).scalar()
            if count == len(_CORE_TABLES):
                checks["db"] = "ok"
            else:
                checks["db"] = f"degraded: {count}/{len(_CORE_TABLES)} core tables present"
                all_ok = False
    except Exception as exc:
        checks["db"] = f"error: {exc}"
        all_ok = False

    try:
        _redis_client().ping()
        checks["redis"] = "ok"
    except (redis.RedisError, Exception) as exc:
        checks["redis"] = f"error: {exc}"
        all_ok = False

    status = "ready" if all_ok else "degraded"
    return {"status": status, "checks": checks}
