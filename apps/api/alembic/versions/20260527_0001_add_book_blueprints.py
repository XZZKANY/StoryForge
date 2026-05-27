"""新增 book_blueprints 最小全书蓝图表。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260527_0001"
down_revision: str | None = "20260520_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建 Phase 9A Blueprint 输入表，复杂设定留给 metadata 扩展。"""

    op.create_table(
        "book_blueprints",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("premise", sa.Text(), nullable=False),
        sa.Column("tone", sa.String(length=255), nullable=False),
        sa.Column("target_word_count", sa.Integer(), nullable=False),
        sa.Column("target_chapter_count", sa.Integer(), nullable=False),
        sa.Column("chapter_word_count_min", sa.Integer(), nullable=False),
        sa.Column("chapter_word_count_max", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=50), server_default="draft", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_book_blueprints_book_id"), "book_blueprints", ["book_id"], unique=False)
    op.add_column("chapters", sa.Column("blueprint_id", sa.Integer(), nullable=True))
    op.add_column("chapters", sa.Column("planning_source", sa.String(length=80), nullable=True))
    op.add_column("chapters", sa.Column("pov", sa.String(length=120), nullable=True))
    op.add_column("chapters", sa.Column("location", sa.String(length=255), nullable=True))
    op.add_column("chapters", sa.Column("required_beats", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("chapters", sa.Column("expected_word_count", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_chapters_blueprint_id"), "chapters", ["blueprint_id"], unique=False)
    op.create_foreign_key(
        "fk_chapters_blueprint_id_book_blueprints",
        "chapters",
        "book_blueprints",
        ["blueprint_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "book_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("blueprint_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=50), server_default="running", nullable=False),
        sa.Column("current_chapter_index", sa.Integer(), server_default="1", nullable=False),
        sa.Column("total_chapters", sa.Integer(), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("checkpoint", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("token_budget", sa.Integer(), nullable=True),
        sa.Column("tokens_used", sa.Integer(), server_default="0", nullable=False),
        sa.Column("time_budget_sec", sa.Integer(), nullable=True),
        sa.Column("elapsed_time_sec", sa.Integer(), server_default="0", nullable=False),
        sa.Column("chapter_budget", sa.Integer(), nullable=True),
        sa.Column("estimated_cost", sa.Float(), server_default="0", nullable=False),
        sa.Column("cost_summary", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blueprint_id"], ["book_blueprints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_book_runs_book_id"), "book_runs", ["book_id"], unique=False)
    op.create_index(op.f("ix_book_runs_blueprint_id"), "book_runs", ["blueprint_id"], unique=False)


def downgrade() -> None:
    """移除 Blueprint 表，回退 Phase 9A 全书规划入口。"""

    op.drop_constraint("fk_chapters_blueprint_id_book_blueprints", "chapters", type_="foreignkey")
    op.drop_index(op.f("ix_book_runs_blueprint_id"), table_name="book_runs")
    op.drop_index(op.f("ix_book_runs_book_id"), table_name="book_runs")
    op.drop_table("book_runs")
    op.drop_index(op.f("ix_chapters_blueprint_id"), table_name="chapters")
    op.drop_column("chapters", "expected_word_count")
    op.drop_column("chapters", "required_beats")
    op.drop_column("chapters", "location")
    op.drop_column("chapters", "pov")
    op.drop_column("chapters", "planning_source")
    op.drop_column("chapters", "blueprint_id")
    op.drop_index(op.f("ix_book_blueprints_book_id"), table_name="book_blueprints")
    op.drop_table("book_blueprints")
