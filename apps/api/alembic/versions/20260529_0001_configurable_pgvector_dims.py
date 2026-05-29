"""configurable pgvector embedding dimensions

Revision ID: 20260529_0001
Revises: 20260528_0001
Create Date: 2026-05-29
"""

from __future__ import annotations

import os

from alembic import op

revision: str = "20260529_0001"
down_revision: str | None = "20260528_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    dims = int(os.getenv("STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS", "1536"))
    op.execute("DROP INDEX IF EXISTS ix_retrieval_chunks_embedding_vector_hnsw")
    op.execute("ALTER TABLE retrieval_chunks DROP COLUMN IF EXISTS embedding_vector")
    op.execute(
        f"ALTER TABLE retrieval_chunks "
        f"ADD COLUMN embedding_vector vector({dims}) "
        f"GENERATED ALWAYS AS (embedding::text::vector({dims})) STORED"
    )
    op.execute(
        "CREATE INDEX ix_retrieval_chunks_embedding_vector_hnsw "
        "ON retrieval_chunks USING hnsw (embedding_vector vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_retrieval_chunks_embedding_vector_hnsw")
    op.execute("ALTER TABLE retrieval_chunks DROP COLUMN IF EXISTS embedding_vector")
    op.execute(
        "ALTER TABLE retrieval_chunks "
        "ADD COLUMN embedding_vector vector(4) "
        "GENERATED ALWAYS AS (embedding::text::vector(4)) STORED"
    )
    op.execute(
        "CREATE INDEX ix_retrieval_chunks_embedding_vector_hnsw "
        "ON retrieval_chunks USING hnsw (embedding_vector vector_cosine_ops)"
    )
