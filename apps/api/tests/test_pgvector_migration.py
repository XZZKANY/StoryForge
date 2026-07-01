from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260520_0001_add_pgvector_retrieval_index.py"
)
MEMORY_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260608_0001_add_memory_atom_embeddings.py"
)
CONFIGURABLE_DIMS_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260529_0001_configurable_pgvector_dims.py"
)


def _load_migration(path: Path, module_name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_pgvector_retrieval_migration_declares_extension_generated_column_and_index() -> None:
    """pgvector 前置迁移必须可被静态审查，避免缺少索引契约。"""

    assert MIGRATION_PATH.exists(), "必须新增 pgvector 检索前置迁移。"
    migration_sql = MIGRATION_PATH.read_text(encoding="utf-8")

    required_fragments = [
        "CREATE TABLE IF NOT EXISTS retrieval_sources",
        "CREATE TABLE IF NOT EXISTS retrieval_chunks",
        "CREATE TABLE IF NOT EXISTS retrieval_refresh_runs",
        "CREATE EXTENSION IF NOT EXISTS vector",
        "embedding_vector vector(4)",
        "GENERATED ALWAYS AS",
        "embedding::text::vector(4)",
        "USING hnsw",
        "vector_cosine_ops",
        "DROP INDEX IF EXISTS ix_retrieval_chunks_embedding_vector_hnsw",
        "DROP COLUMN IF EXISTS embedding_vector",
    ]
    for fragment in required_fragments:
        assert fragment in migration_sql
    assert 'down_revision: str | None = "c0ffee20260520"' in migration_sql


def test_pgvector_memory_migration_declares_embedding_column_and_index() -> None:
    """memory_atoms 也必须具备持久化 embedding 与 pgvector 候选索引契约。"""

    assert MEMORY_MIGRATION_PATH.exists(), "必须新增 Story Memory pgvector 迁移。"
    migration_sql = MEMORY_MIGRATION_PATH.read_text(encoding="utf-8")

    required_fragments = [
        'revision: str = "20260608_0001"',
        'down_revision: str | None = "20260604_0001"',
        'sa.Column("embedding", sa.JSON(), nullable=False, server_default="[]")',
        "CREATE EXTENSION IF NOT EXISTS vector",
        "ADD COLUMN embedding_vector vector(",
        "GENERATED ALWAYS AS",
        "json_array_length(embedding)",
        "THEN embedding::text::vector(",
        "ELSE NULL",
        "ix_memory_atoms_embedding_vector_hnsw",
        "ON memory_atoms USING hnsw",
        "vector_cosine_ops",
        "DROP COLUMN IF EXISTS embedding_vector",
    ]
    for fragment in required_fragments:
        assert fragment in migration_sql

    assert "GENERATED ALWAYS AS (embedding::text::vector(" not in migration_sql


@pytest.mark.parametrize(
    ("path", "module_name"),
    [
        (MIGRATION_PATH, "pgvector_retrieval_migration_for_sqlite_skip_test"),
        (CONFIGURABLE_DIMS_MIGRATION_PATH, "pgvector_dims_migration_for_sqlite_skip_test"),
        (MEMORY_MIGRATION_PATH, "pgvector_memory_migration_for_sqlite_skip_test"),
    ],
)
def test_pgvector_migrations_skip_all_ddl_for_non_postgresql(
    path: Path, module_name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """桌面 sqlite 路径不能执行 PostgreSQL/pgvector 专用 DDL。"""

    module = _load_migration(path, module_name)
    sqlite_context = SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))

    monkeypatch.setattr(module.context, "get_context", lambda: sqlite_context)
    monkeypatch.setattr(module.op, "execute", pytest.fail)
    monkeypatch.setattr(module.op, "add_column", pytest.fail)
    monkeypatch.setattr(module.op, "drop_column", pytest.fail)

    module.upgrade()
    module.downgrade()
