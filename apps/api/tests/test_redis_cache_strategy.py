"""Stage 7-2 Redis 缓存策略集成测试。

通过 monkeypatch 把 cache_get/set 替换为内存映射，验证写入失效、TTL 配置等行为。
"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.common import redis_cache
from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.artifacts.service import (
    _artifact_list_cache_key,
    create_artifact,
    list_artifacts_cached,
)
from app.domains.assets.schemas import AssetCreate
from app.domains.assets.service import create_asset
from app.domains.books.models import Book
from app.domains.series.models import Series
from app.domains.worldbuilding.service import (
    build_worldbuilding_center,
    invalidate_worldbuilding_cache,
)


class _FakeCache:
    """内存替身，模拟 Redis cache_get_value / cache_set_value / cache_delete_pattern。"""

    def __init__(self) -> None:
        self.store: dict[str, object] = {}
        self.get_calls = 0
        self.set_calls = 0
        self.delete_calls = 0

    def get(self, key: str):
        self.get_calls += 1
        return self.store.get(key)

    def set(self, key: str, value, ttl_seconds: int = 0) -> None:
        self.set_calls += 1
        self.store[key] = value

    def delete_pattern(self, pattern: str) -> None:
        self.delete_calls += 1
        prefix = pattern.rstrip("*")
        for key in list(self.store.keys()):
            if key.startswith(prefix):
                del self.store[key]


@pytest.fixture()
def fake_cache(monkeypatch: pytest.MonkeyPatch) -> _FakeCache:
    cache = _FakeCache()
    monkeypatch.setattr(redis_cache, "cache_get_value", cache.get)
    monkeypatch.setattr(redis_cache, "cache_set_value", lambda key, value, ttl: cache.set(key, value, ttl))
    monkeypatch.setattr(
        redis_cache, "cache_delete_pattern", lambda pattern: cache.delete_pattern(pattern)
    )
    # 同时 patch 业务模块导入的引用，因为 from-import 创建了独立绑定。
    from app.domains.artifacts import service as artifacts_service
    from app.domains.worldbuilding import service as worldbuilding_service

    monkeypatch.setattr(artifacts_service, "cache_get_value", cache.get)
    monkeypatch.setattr(
        artifacts_service, "cache_set_value", lambda key, value, ttl: cache.set(key, value, ttl)
    )
    monkeypatch.setattr(
        artifacts_service, "cache_delete_pattern", lambda pattern: cache.delete_pattern(pattern)
    )
    monkeypatch.setattr(worldbuilding_service, "cache_get_value", cache.get)
    monkeypatch.setattr(
        worldbuilding_service, "cache_set_value", lambda key, value, ttl: cache.set(key, value, ttl)
    )
    monkeypatch.setattr(
        worldbuilding_service, "cache_delete_pattern", lambda pattern: cache.delete_pattern(pattern)
    )
    return cache


def test_artifact_list_cache_returns_cached_payload_on_second_call(
    session: Session, fake_cache: _FakeCache
) -> None:
    book = Book(title="缓存样本", status="draft", premise="验证缓存。")
    session.add(book)
    session.commit()
    create_artifact(
        session,
        ArtifactCreate(
            book_id=book.id,
            artifact_type="reference",
            name="cache-target",
            storage_uri="memory://a",
            mime_type="text/plain",
        ),
    )

    fake_cache.get_calls = 0
    first = list_artifacts_cached(session, book_id=book.id)
    second = list_artifacts_cached(session, book_id=book.id)

    cache_key = _artifact_list_cache_key(None, book.id)
    assert cache_key in fake_cache.store
    assert fake_cache.get_calls == 2
    assert [item.id for item in first] == [item.id for item in second]


def test_artifact_create_invalidates_list_cache(
    session: Session, fake_cache: _FakeCache
) -> None:
    book = Book(title="缓存失效样本", status="draft", premise="验证失效。")
    session.add(book)
    session.commit()
    list_artifacts_cached(session, book_id=book.id)
    cache_key = _artifact_list_cache_key(None, book.id)
    assert cache_key in fake_cache.store

    create_artifact(
        session,
        ArtifactCreate(
            book_id=book.id,
            artifact_type="reference",
            name="新增制品",
            storage_uri="memory://b",
            mime_type="text/plain",
        ),
    )

    assert cache_key not in fake_cache.store


def test_worldbuilding_center_cache_serves_repeated_calls(
    session: Session, fake_cache: _FakeCache
) -> None:
    series = Series(title="灯塔系列", description="系列描述")
    session.add(series)
    session.commit()

    first = build_worldbuilding_center(session, series_id=series.id)
    cache_key = f"storyforge:worldbuilding-center:series:{series.id}:all"
    assert cache_key in fake_cache.store

    second = build_worldbuilding_center(session, series_id=series.id)
    assert first.series.id == second.series.id == series.id


def test_asset_write_invalidates_worldbuilding_cache(
    session: Session, fake_cache: _FakeCache
) -> None:
    series = Series(title="资产缓存", description="资产写后失效")
    session.add(series)
    session.flush()
    book = Book(title="资产书", status="draft", premise="x", series_id=series.id) if hasattr(Book, "series_id") else Book(title="资产书", status="draft", premise="x")
    session.add(book)
    session.commit()
    build_worldbuilding_center(session, series_id=series.id)
    cache_key = f"storyforge:worldbuilding-center:series:{series.id}:all"
    assert cache_key in fake_cache.store

    create_asset(
        session,
        AssetCreate(book_id=book.id, asset_type="character", name="林岚"),
    )
    # 资产作用域无法直接反查 series_id，默认全失效，世界观缓存应被清空。
    assert cache_key not in fake_cache.store


def test_invalidate_worldbuilding_cache_explicit_series_only_clears_matching(
    fake_cache: _FakeCache,
) -> None:
    fake_cache.store["storyforge:worldbuilding-center:series:1:all"] = {"x": 1}
    fake_cache.store["storyforge:worldbuilding-center:series:2:all"] = {"x": 2}
    invalidate_worldbuilding_cache(series_id=1)
    assert "storyforge:worldbuilding-center:series:1:all" not in fake_cache.store
    assert "storyforge:worldbuilding-center:series:2:all" in fake_cache.store


def test_redis_client_uses_short_timeouts(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redis 不可用时缓存降级必须迅速返回，不能拖死本地导出验证。"""

    calls: list[dict[str, object]] = []

    class FakeRedis:
        @staticmethod
        def from_url(url: str, **kwargs):
            calls.append({"url": url, **kwargs})
            return object()

    monkeypatch.setattr(redis_cache, "redis", type("RedisModule", (), {"Redis": FakeRedis, "RedisError": Exception}))
    redis_cache._redis_client.cache_clear()

    redis_cache._redis_client()

    assert calls
    assert calls[0]["socket_connect_timeout"] <= 1.0
    assert calls[0]["socket_timeout"] <= 1.0


def test_cache_delete_pattern_treats_incomplete_client_as_cache_miss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """测试替身只验证连接参数时，缓存删除也必须按 Redis 不可用降级。"""

    monkeypatch.setattr(redis_cache, "_redis_client", lambda: object())

    redis_cache.cache_delete_pattern("storyforge:any:*")
