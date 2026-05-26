#!/usr/bin/env python3
"""StoryForge Alembic 迁移包装器。

使用 PostgreSQL advisory lock 串行化多副本启动时的迁移，避免并发执行 ``alembic
upgrade head``。锁键固定为 ``8294718273``（项目内任意选定的 bigint）。

环境变量：
    DATABASE_URL                Postgres 连接串（必填）。
    STORYFORGE_MIGRATION_TIMEOUT  等待数据库可用的最长秒数，默认 120。

用法：
    storyforge-migrate                  # 等价于 ``alembic upgrade head``
    storyforge-migrate downgrade -1     # 透传其余 alembic 命令
"""

from __future__ import annotations

import os
import subprocess
import sys
import time

import psycopg

_LOCK_KEY = 8294718273
_DEFAULT_TIMEOUT_SECONDS = 120


def _resolve_dsn() -> str:
    raw = os.environ.get(
        "DATABASE_URL",
        "postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge",
    )
    return raw.replace("postgresql+psycopg://", "postgresql://", 1)


def _wait_for_database(dsn: str, timeout_seconds: float) -> psycopg.Connection:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return psycopg.connect(dsn, autocommit=True)
        except Exception as exc:  # noqa: BLE001 - retry on any transient connection error
            last_error = exc
            print(f"[migrate] waiting for database: {exc}", flush=True)
            time.sleep(2)
    raise SystemExit(f"[migrate] database unavailable after {timeout_seconds}s: {last_error}")


def _alembic_command(argv: list[str]) -> list[str]:
    if not argv:
        return ["alembic", "upgrade", "head"]
    return ["alembic", *argv]


def main() -> int:
    timeout_seconds = float(
        os.environ.get("STORYFORGE_MIGRATION_TIMEOUT", _DEFAULT_TIMEOUT_SECONDS)
    )
    dsn = _resolve_dsn()
    command = _alembic_command(sys.argv[1:])

    with _wait_for_database(dsn, timeout_seconds) as conn:
        with conn.cursor() as cur:
            print(f"[migrate] acquiring advisory lock {_LOCK_KEY}", flush=True)
            cur.execute("SELECT pg_advisory_lock(%s)", (_LOCK_KEY,))
        try:
            print(f"[migrate] running: {' '.join(command)}", flush=True)
            result = subprocess.run(command, check=False)
            return result.returncode
        finally:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(%s)", (_LOCK_KEY,))
                print(f"[migrate] released advisory lock {_LOCK_KEY}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
