from __future__ import annotations

import os
from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine
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


def _build_engine_options(database_url: str) -> dict[str, int | bool]:
    """按数据库类型生成连接池参数，避免 SQLite 测试替身接收不兼容选项。"""

    if database_url.startswith("sqlite"):
        return {}
    return {
        "pool_size": _get_int_env("STORYFORGE_DB_POOL_SIZE", 10),
        "max_overflow": _get_int_env("STORYFORGE_DB_MAX_OVERFLOW", 20),
        "pool_pre_ping": _get_bool_env("STORYFORGE_DB_POOL_PRE_PING", True),
        "pool_timeout": _get_int_env("STORYFORGE_DB_POOL_TIMEOUT", 30),
        "pool_recycle": _get_int_env("STORYFORGE_DB_POOL_RECYCLE", 300),
    }


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """首次需要数据库时才创建 engine，使运行时环境配置可生效。"""

    database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    return create_engine(database_url, **_build_engine_options(database_url))


def bootstrap_sqlite_database(engine: Engine | None = None) -> None:
    """桌面/本地 SQLite 运行态没有 Alembic 服务时，用 ORM 元数据补齐表结构。"""

    target_engine = engine or get_engine()
    if target_engine.dialect.name != "sqlite":
        return

    import app.models  # noqa: F401
    from app.db.base import Base

    Base.metadata.create_all(target_engine)


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
