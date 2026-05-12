"""为资产增加版本谱系键

Revision ID: 9f2b3c4d5e6f
Revises: 71dfabf6badf
Create Date: 2026-05-12 22:45:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "9f2b3c4d5e6f"
down_revision: str | None = "71dfabf6badf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """为资产表补充稳定谱系键，支撑版本历史查询。"""

    op.add_column("assets", sa.Column("lineage_key", sa.String(length=80), nullable=True))
    op.execute("UPDATE assets SET lineage_key = 'asset-' || id WHERE lineage_key IS NULL")
    op.alter_column("assets", "lineage_key", nullable=False)
    op.create_index(op.f("ix_assets_lineage_key"), "assets", ["lineage_key"], unique=False)


def downgrade() -> None:
    """移除资产谱系键。"""

    op.drop_index(op.f("ix_assets_lineage_key"), table_name="assets")
    op.drop_column("assets", "lineage_key")