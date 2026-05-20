from __future__ import annotations

from collections.abc import Generator
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DEFAULT_DATABASE_URL = "postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


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
    }


engine = create_engine(DATABASE_URL, **_build_engine_options(DATABASE_URL))
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    """为请求提供独立数据库会话，路由层只依赖该协议。"""

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
