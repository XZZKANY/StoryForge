"""为检索 embedding 准备 pgvector 索引列。"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import context, op

revision: str = "20260520_0001"
down_revision: str | None = "c0ffee20260520"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CREATE_RETRIEVAL_SOURCES_SQL = """
CREATE TABLE IF NOT EXISTS retrieval_sources (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
    series_id INTEGER,
    source_type VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    content_text TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
)
"""

CREATE_RETRIEVAL_CHUNKS_SQL = """
CREATE TABLE IF NOT EXISTS retrieval_chunks (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_id INTEGER NOT NULL REFERENCES retrieval_sources(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    embedding JSONB NOT NULL DEFAULT '[]'::jsonb
)
"""

CREATE_RETRIEVAL_REFRESH_RUNS_SQL = """
CREATE TABLE IF NOT EXISTS retrieval_refresh_runs (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_id INTEGER REFERENCES retrieval_sources(id) ON DELETE SET NULL,
    book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
    series_id INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'completed',
    chunk_count INTEGER NOT NULL DEFAULT 0,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
)
"""

CREATE_RETRIEVAL_SUPPORT_INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS ix_retrieval_sources_book_id ON retrieval_sources (book_id);
CREATE INDEX IF NOT EXISTS ix_retrieval_sources_series_id ON retrieval_sources (series_id);
CREATE INDEX IF NOT EXISTS ix_retrieval_chunks_source_id ON retrieval_chunks (source_id);
CREATE INDEX IF NOT EXISTS ix_retrieval_refresh_runs_source_id ON retrieval_refresh_runs (source_id);
CREATE INDEX IF NOT EXISTS ix_retrieval_refresh_runs_book_id ON retrieval_refresh_runs (book_id);
CREATE INDEX IF NOT EXISTS ix_retrieval_refresh_runs_series_id ON retrieval_refresh_runs (series_id);
"""

PGVECTOR_EXTENSION_SQL = "CREATE EXTENSION IF NOT EXISTS vector"

ADD_EMBEDDING_VECTOR_SQL = """
ALTER TABLE retrieval_chunks
ADD COLUMN IF NOT EXISTS embedding_vector vector(4)
GENERATED ALWAYS AS (embedding::text::vector(4)) STORED
"""

CREATE_EMBEDDING_VECTOR_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS ix_retrieval_chunks_embedding_vector_hnsw
ON retrieval_chunks USING hnsw (embedding_vector vector_cosine_ops)
"""

DROP_EMBEDDING_VECTOR_INDEX_SQL = """
DROP INDEX IF EXISTS ix_retrieval_chunks_embedding_vector_hnsw
"""

DROP_EMBEDDING_VECTOR_COLUMN_SQL = """
ALTER TABLE retrieval_chunks
DROP COLUMN IF EXISTS embedding_vector
"""


def _is_postgresql() -> bool:
    return context.get_context().dialect.name == "postgresql"


def upgrade() -> None:
    """新增 PostgreSQL 侧向量列和 HNSW 索引，不改变应用 JSON 写入契约。"""

    if not _is_postgresql():
        return

    op.execute(CREATE_RETRIEVAL_SOURCES_SQL)
    op.execute(CREATE_RETRIEVAL_CHUNKS_SQL)
    op.execute(CREATE_RETRIEVAL_REFRESH_RUNS_SQL)
    op.execute(CREATE_RETRIEVAL_SUPPORT_INDEXES_SQL)
    op.execute(PGVECTOR_EXTENSION_SQL)
    op.execute(ADD_EMBEDDING_VECTOR_SQL)
    op.execute(CREATE_EMBEDDING_VECTOR_INDEX_SQL)


def downgrade() -> None:
    """移除 pgvector 前置索引列，保留原始 JSON embedding。"""

    if not _is_postgresql():
        return

    op.execute(DROP_EMBEDDING_VECTOR_INDEX_SQL)
    op.execute(DROP_EMBEDDING_VECTOR_COLUMN_SQL)
