"""新增 Character Bible 最小角色规范表。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260527_0003"
down_revision: str | None = "20260527_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建角色规范硬规则表，供后续一致性检查读取。"""

    op.create_table(
        "character_bible_entries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("character_id", sa.Integer(), nullable=True),
        sa.Column("canonical_name", sa.String(length=255), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.Column("voice_traits", sa.JSON(), nullable=False),
        sa.Column("forbidden_traits", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["character_id"], ["assets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_character_bible_entries_book_id"), "character_bible_entries", ["book_id"], unique=False)
    op.create_index(
        op.f("ix_character_bible_entries_character_id"),
        "character_bible_entries",
        ["character_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_character_bible_entries_canonical_name"),
        "character_bible_entries",
        ["canonical_name"],
        unique=False,
    )


def downgrade() -> None:
    """移除角色规范表。"""

    op.drop_index(op.f("ix_character_bible_entries_canonical_name"), table_name="character_bible_entries")
    op.drop_index(op.f("ix_character_bible_entries_character_id"), table_name="character_bible_entries")
    op.drop_index(op.f("ix_character_bible_entries_book_id"), table_name="character_bible_entries")
    op.drop_table("character_bible_entries")
