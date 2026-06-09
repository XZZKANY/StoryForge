from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select

import app.models  # noqa: F401
from app.domains.retrieval.pgvector import (
    PGVECTOR_DIMENSION_MISMATCH,
    PGVECTOR_ENGAGED,
    PGVECTOR_NO_QUERY_EMBEDDING,
    PGVECTOR_NON_POSTGRESQL,
    evaluate_pgvector_decision,
    pgvector_dimensions,
)
from app.domains.story_memory import service as story_memory_service
from app.domains.story_memory.models import MemoryAtomRecord


class _DialectSession:
    def __init__(self, name: str) -> None:
        self._name = name

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name=self._name))


class _BrokenBindSession:
    def get_bind(self):
        raise RuntimeError("no bind")


def test_pgvector_dimensions_reads_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_DEMO_PGVECTOR_DIMENSIONS", "8")
    assert pgvector_dimensions("STORYFORGE_DEMO_PGVECTOR_DIMENSIONS", 1536) == 8


def test_pgvector_dimensions_falls_back_on_invalid_or_nonpositive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_DEMO_PGVECTOR_DIMENSIONS", "invalid")
    assert pgvector_dimensions("STORYFORGE_DEMO_PGVECTOR_DIMENSIONS", 1536) == 1536
    monkeypatch.setenv("STORYFORGE_DEMO_PGVECTOR_DIMENSIONS", "0")
    assert pgvector_dimensions("STORYFORGE_DEMO_PGVECTOR_DIMENSIONS", 1536) == 1536


def test_decision_no_query_embedding() -> None:
    assert (
        evaluate_pgvector_decision(_DialectSession("postgresql"), None, expected_dims=3)
        == PGVECTOR_NO_QUERY_EMBEDDING
    )


def test_decision_dimension_mismatch() -> None:
    assert (
        evaluate_pgvector_decision(_DialectSession("postgresql"), [0.1, 0.2], expected_dims=3)
        == PGVECTOR_DIMENSION_MISMATCH
    )


def test_decision_non_postgresql() -> None:
    assert (
        evaluate_pgvector_decision(_DialectSession("sqlite"), [0.1, 0.2, 0.3], expected_dims=3)
        == PGVECTOR_NON_POSTGRESQL
    )


def test_decision_broken_bind_is_non_postgresql() -> None:
    assert (
        evaluate_pgvector_decision(_BrokenBindSession(), [0.1, 0.2, 0.3], expected_dims=3)
        == PGVECTOR_NON_POSTGRESQL
    )


def test_decision_engaged_on_postgresql_with_matching_dims() -> None:
    assert (
        evaluate_pgvector_decision(_DialectSession("postgresql"), [0.1, 0.2, 0.3], expected_dims=3)
        == PGVECTOR_ENGAGED
    )


class _SqliteEmptySession:
    """模拟非 PostgreSQL 会话：带向量也只能回退默认排序召回。"""

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))

    def scalars(self, statement, params=None):
        class _Result:
            def all(self_inner):
                return []

        return _Result()


def test_memory_recall_logs_fallback_reason_when_vector_present(caplog: pytest.LogCaptureFixture) -> None:
    """带 query 向量但无法走 pgvector 时，必须留下可诊断的回退日志（不再静默）。"""

    statement = select(MemoryAtomRecord).where(MemoryAtomRecord.book_id == 1)
    with caplog.at_level("INFO", logger="app.domains.story_memory.service"):
        records = story_memory_service._load_memory_atom_candidates(
            _SqliteEmptySession(),
            statement,
            query_embedding=[0.1, 0.2, 0.3],
            limit=3,
        )
    assert records == []
    assert any("memory pgvector 未启用" in record.message for record in caplog.records)
