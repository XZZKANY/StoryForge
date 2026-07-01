"""为 memory_atoms 增加持久化 embedding 与 pgvector 候选索引。"""

from __future__ import annotations

import os

import sqlalchemy as sa

from alembic import context, op

revision: str = "20260608_0001"
down_revision: str | None = "20260604_0001"
branch_labels = None
depends_on = None


def _dims() -> int:
    try:
        value = int(os.getenv("STORYFORGE_MEMORY_PGVECTOR_DIMENSIONS", "1536"))
    except ValueError:
        return 1536
    return value if value > 0 else 1536


def _is_postgresql() -> bool:
    return context.get_context().dialect.name == "postgresql"


def upgrade() -> None:
    if not _is_postgresql():
        return

    dims = _dims()
    op.add_column("memory_atoms", sa.Column("embedding", sa.JSON(), nullable=False, server_default="[]"))
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("DROP INDEX IF EXISTS ix_memory_atoms_embedding_vector_hnsw")
    op.execute("ALTER TABLE memory_atoms DROP COLUMN IF EXISTS embedding_vector")
    op.execute(
        f"ALTER TABLE memory_atoms "
        f"ADD COLUMN embedding_vector vector({dims}) "
        f"GENERATED ALWAYS AS ("
        f"CASE "
        f"WHEN json_array_length(embedding) = {dims} THEN embedding::text::vector({dims}) "
        f"ELSE NULL "
        f"END"
        f") STORED"
    )
    op.execute(
        "CREATE INDEX ix_memory_atoms_embedding_vector_hnsw "
        "ON memory_atoms USING hnsw (embedding_vector vector_cosine_ops)"
    )


def downgrade() -> None:
    if not _is_postgresql():
        return

    op.execute("DROP INDEX IF EXISTS ix_memory_atoms_embedding_vector_hnsw")
    op.execute("ALTER TABLE memory_atoms DROP COLUMN IF EXISTS embedding_vector")
    op.drop_column("memory_atoms", "embedding")
