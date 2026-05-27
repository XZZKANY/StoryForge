"""为 memory_atoms 增加章节来源引用。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260527_0002"
down_revision: str | None = "20260527_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """记录 approve 后抽取的章节来源，支撑长程记忆审计。"""

    op.add_column("memory_atoms", sa.Column("source_chapter_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_memory_atoms_source_chapter_id"), "memory_atoms", ["source_chapter_id"], unique=False)
    op.create_foreign_key(
        "fk_memory_atoms_source_chapter_id_chapters",
        "memory_atoms",
        "chapters",
        ["source_chapter_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """移除章节来源引用。"""

    op.drop_constraint("fk_memory_atoms_source_chapter_id_chapters", "memory_atoms", type_="foreignkey")
    op.drop_index(op.f("ix_memory_atoms_source_chapter_id"), table_name="memory_atoms")
    op.drop_column("memory_atoms", "source_chapter_id")
