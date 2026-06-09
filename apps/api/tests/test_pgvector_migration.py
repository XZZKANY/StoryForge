from __future__ import annotations

from pathlib import Path

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
