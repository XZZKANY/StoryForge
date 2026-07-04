from __future__ import annotations

import logging
import os
from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

DEFAULT_DATABASE_URL = "postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge"


def _get_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError:
        return default
    return value if value >= 0 else default


def _get_bool_env(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() not in {"0", "false", "no", "off"}


def _build_engine_options(database_url: str) -> dict:
    """按数据库类型生成连接池参数，避免 SQLite 测试替身接收不兼容选项。"""

    if database_url.startswith("sqlite"):
        # 桌面 sidecar:WS agent 线程与请求线程并发写同一文件库,
        # 驱动级 busy timeout 是防 "database is locked" 的第一道闸。
        return {
            "connect_args": {"timeout": _get_int_env("STORYFORGE_SQLITE_BUSY_TIMEOUT_SECONDS", 30)}
        }
    return {
        "pool_size": _get_int_env("STORYFORGE_DB_POOL_SIZE", 10),
        "max_overflow": _get_int_env("STORYFORGE_DB_MAX_OVERFLOW", 20),
        "pool_pre_ping": _get_bool_env("STORYFORGE_DB_POOL_PRE_PING", True),
        "pool_timeout": _get_int_env("STORYFORGE_DB_POOL_TIMEOUT", 30),
        "pool_recycle": _get_int_env("STORYFORGE_DB_POOL_RECYCLE", 300),
    }


def _enable_sqlite_wal(engine: Engine) -> None:
    """文件库启用 WAL,允许读写并发;:memory: 下该 PRAGMA 无效但无害。"""

    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _set_sqlite_wal(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
        finally:
            cursor.close()


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """首次需要数据库时才创建 engine，使运行时环境配置可生效。"""

    database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    engine = create_engine(database_url, **_build_engine_options(database_url))
    if engine.dialect.name == "sqlite":
        _enable_sqlite_wal(engine)
    return engine


def bootstrap_sqlite_database(engine: Engine | None = None) -> None:
    """桌面/本地 SQLite 起服的 schema 收口（W2，见 app/db/migrations.py）。

    - 已纳管库（有 alembic_version）：``upgrade head`` 落地发版新增的 batch 安全迁移，堵 F01。
    - 存量 create_all 库（有业务表、无 alembic_version）：备份 + quick_check + create_all 补表
      + 补 agent_run_events 唯一索引 + ``stamp head``，一次性纳入 alembic 管理。
    - 全新库：create_all 建表 + ``stamp head``。

    历史迁移链无法在 SQLite 上从 base 重放，故建表仍靠 create_all；alembic 只管前向演进。
    任一 alembic 步骤失败即回退纯 create_all 并告警，保证 sidecar 仍能起服。"""

    target_engine = engine or get_engine()
    if target_engine.dialect.name != "sqlite":
        return

    import app.models  # noqa: F401
    from app.db import migrations
    from app.db.base import Base

    existing_tables = set(inspect(target_engine).get_table_names())
    has_alembic_version = "alembic_version" in existing_tables
    has_business_tables = bool(existing_tables - {"alembic_version"})

    try:
        if has_alembic_version:
            migrations.upgrade_head(target_engine)
        elif has_business_tables:
            _adopt_legacy_sqlite_database(target_engine, Base, migrations)
        else:
            Base.metadata.create_all(target_engine)
            migrations.stamp_head(target_engine)
    except Exception:  # noqa: BLE001 - 起服路径：alembic 收口失败回退 create_all，库仍可用
        logging.getLogger(__name__).warning(
            "sqlite alembic 收口失败，回退到 create_all（schema 未纳入 alembic 管理）。",
            exc_info=True,
        )
        Base.metadata.create_all(target_engine)
        _ensure_agent_run_event_sequence_unique(target_engine)


def _adopt_legacy_sqlite_database(engine: Engine, base, migrations) -> None:
    """把 W2 之前 create_all 建出的存量库纳入 alembic 管理：先备份、体检，
    再补齐可能缺失的表与唯一索引，最后 stamp head（不重放历史迁移）。"""

    from app.common.version import APP_VERSION

    log = logging.getLogger(__name__)
    healthy, detail = migrations.quick_check(engine)
    if not healthy:
        # 库损坏：中止纳管，抛出交由上层回退 create_all，不在损坏库上再动 schema。
        raise RuntimeError(f"sqlite quick_check 失败，中止 alembic 纳管：{detail}")

    migrations.backup_sqlite_database(engine, tag=APP_VERSION)
    base.metadata.create_all(engine)  # 补齐存量库缺失的整表（不补列）
    _ensure_agent_run_event_sequence_unique(engine)  # 镜像迁移 20260703_0001，create_all 不给存量表补索引
    migrations.stamp_head(engine)
    log.info("legacy sqlite 库已纳入 alembic 管理（stamp head）。")


def _ensure_agent_run_event_sequence_unique(engine: Engine) -> None:
    """老 sidecar 库先把并发竞态残留的重复 (run_id, sequence) 按 (sequence, id) 重排，
    再建唯一索引，使 record_agent_event 的冲突重试有约束可依。逻辑与迁移
    20260703_0001 一致，仅用于存量库纳管/回退（create_all 不给存量表补索引）；
    失败只告警不阻断起服（库仍可用，只是回到无约束现状）。"""

    renumber_sql = """
    UPDATE agent_run_events SET sequence = (
        SELECT COUNT(*) FROM agent_run_events AS prior
        WHERE prior.run_id = agent_run_events.run_id
          AND (prior.sequence < agent_run_events.sequence
               OR (prior.sequence = agent_run_events.sequence AND prior.id <= agent_run_events.id))
    )
    WHERE run_id IN (
        SELECT run_id FROM agent_run_events GROUP BY run_id, sequence HAVING COUNT(*) > 1
    )
    """
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(renumber_sql)
            connection.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_run_events_run_sequence "
                "ON agent_run_events (run_id, sequence)"
            )
    except Exception:  # noqa: BLE001 - 起服路径，索引补齐失败不应让 sidecar 无法启动
        logging.getLogger(__name__).warning("agent_run_events 唯一索引补齐失败，跳过。", exc_info=True)


_SessionFactory = sessionmaker(autoflush=False, autocommit=False, expire_on_commit=False)


def SessionLocal() -> Session:
    """创建绑定到懒加载 engine 的 ORM 会话，保持既有无参调用协议。"""

    return _SessionFactory(bind=get_engine())


def get_session() -> Generator[Session, None, None]:
    """为请求提供独立数据库会话，路由层只依赖该协议。"""

    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
