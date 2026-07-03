from __future__ import annotations

import os
from typing import Any

import redis
from fastapi import APIRouter
from sqlalchemy import inspect
from sqlalchemy.engine import Connection

from app.common.redis_cache import _redis_client
from app.common.version import APP_VERSION
from app.db.session import get_engine

router = APIRouter(prefix="/health", tags=["运行状态"])

_CORE_TABLES = ["books", "artifacts", "workspaces"]


def _desktop_skip_services() -> bool:
    raw_value = os.getenv("STORYFORGE_DESKTOP_SKIP_SERVICES", "")
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _core_table_count(conn: Connection) -> int:
    inspector = inspect(conn)
    return sum(1 for table_name in _CORE_TABLES if inspector.has_table(table_name))


@router.get(
    "/live",
    summary="进程存活探针",
)
def liveness() -> dict[str, str]:
    """仅返回 200 表明进程存活，不检查任何外部依赖。供 Kubernetes liveness 调用。"""

    return {"status": "alive"}


@router.get(
    "/ready",
    summary="就绪探针",
)
def readiness() -> dict[str, str | dict[str, Any]]:
    """检查数据库连接 + 核心表存在 + Redis 可达；任一失败则标记为 degraded。"""

    checks: dict[str, Any] = {}
    all_ok = True

    try:
        with get_engine().connect() as conn:
            count = _core_table_count(conn)
            if count == len(_CORE_TABLES):
                checks["db"] = "ok"
            else:
                checks["db"] = f"degraded: {count}/{len(_CORE_TABLES)} core tables present"
                all_ok = False
    except Exception as exc:
        checks["db"] = f"error: {exc}"
        all_ok = False

    if _desktop_skip_services():
        checks["redis"] = "skipped"
    else:
        try:
            _redis_client().ping()
            checks["redis"] = "ok"
        except (redis.RedisError, Exception) as exc:
            checks["redis"] = f"error: {exc}"
            all_ok = False

    status = "ready" if all_ok else "degraded"
    return {"status": status, "app_version": APP_VERSION, "checks": checks}
