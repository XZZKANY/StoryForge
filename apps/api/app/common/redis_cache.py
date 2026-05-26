from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

import redis

DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0"


@lru_cache(maxsize=1)
def _redis_client() -> redis.Redis:
    """按运行时环境创建 Redis 客户端，连接失败由调用方降级处理。"""

    redis_url = os.getenv("STORYFORGE_REDIS_URL") or os.getenv("REDIS_URL") or DEFAULT_REDIS_URL
    return redis.Redis.from_url(redis_url, decode_responses=True)


def cache_get_json(key: str) -> dict[str, Any] | None:
    """读取 JSON 缓存；Redis 不可用或内容异常时按未命中处理。"""

    try:
        raw_value = _redis_client().get(key)
    except redis.RedisError:
        return None
    if not raw_value:
        return None
    try:
        value = json.loads(raw_value)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def cache_set_json(key: str, value: dict[str, Any], ttl_seconds: int) -> None:
    """写入 JSON 缓存；Redis 不可用时不影响主流程。"""

    try:
        _redis_client().set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)
    except (TypeError, redis.RedisError):
        return


def cache_get_value(key: str) -> Any | None:
    """读取任意 JSON 值（dict/list/标量）；Redis 不可用或内容异常时返回 None。"""

    try:
        raw_value = _redis_client().get(key)
    except redis.RedisError:
        return None
    if not raw_value:
        return None
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError:
        return None


def cache_set_value(key: str, value: Any, ttl_seconds: int) -> None:
    """写入任意 JSON 可序列化值；Redis 不可用或序列化失败时不影响主流程。"""

    try:
        _redis_client().set(key, json.dumps(value, ensure_ascii=False, default=str), ex=ttl_seconds)
    except (TypeError, redis.RedisError):
        return


def cache_delete(key: str) -> None:
    """删除单个缓存键。"""

    try:
        _redis_client().delete(key)
    except redis.RedisError:
        return


def cache_delete_pattern(pattern: str) -> None:
    """按 pattern 删除缓存键，使用 SCAN 避免阻塞 Redis。"""

    try:
        client = _redis_client()
        for key in client.scan_iter(match=pattern, count=100):
            client.delete(key)
    except redis.RedisError:
        return
