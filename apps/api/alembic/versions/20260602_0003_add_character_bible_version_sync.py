"""为 Character Bible 增加版本谱系和记忆同步字段。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260602_0003"
down_revision: str | None = "20260602_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """补齐角色规范版本、谱系和 Story Memory 同步状态字段。"""

    op.add_column("character_bible_entries", sa.Column("lineage_key", sa.String(length=80), nullable=True))
    op.add_column(
        "character_bible_entries",
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "character_bible_entries",
        sa.Column("sync_status", sa.String(length=50), server_default="pending", nullable=False),
    )
    op.add_column("character_bible_entries", sa.Column("memory_atom_id", sa.String(length=80), nullable=True))
    op.execute(
        "UPDATE character_bible_entries "
        "SET lineage_key = 'character-bible:' || CAST(id AS VARCHAR), sync_status = 'synced' "
        "WHERE lineage_key IS NULL"
    )
    with op.batch_alter_table("character_bible_entries") as batch_op:
        batch_op.alter_column("lineage_key", existing_type=sa.String(length=80), nullable=False)
    op.create_index(
        op.f("ix_character_bible_entries_lineage_key"),
        "character_bible_entries",
        ["lineage_key"],
        unique=False,
    )
    op.create_index(
        op.f("ix_character_bible_entries_version"),
        "character_bible_entries",
        ["version"],
        unique=False,
    )


def downgrade() -> None:
    """移除 Character Bible 版本谱系和同步字段。"""

    op.drop_index(op.f("ix_character_bible_entries_version"), table_name="character_bible_entries")
    op.drop_index(op.f("ix_character_bible_entries_lineage_key"), table_name="character_bible_entries")
    op.drop_column("character_bible_entries", "memory_atom_id")
    op.drop_column("character_bible_entries", "sync_status")
    op.drop_column("character_bible_entries", "version")
    op.drop_column("character_bible_entries", "lineage_key")
