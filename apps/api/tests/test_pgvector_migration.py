from __future__ import annotations

from pathlib import Path


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260520_0001_add_pgvector_retrieval_index.py"
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
