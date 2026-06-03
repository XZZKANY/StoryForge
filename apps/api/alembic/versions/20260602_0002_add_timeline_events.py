"""新增 TimelineEvent 持久化表。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260602_0002"
down_revision: str | None = "20260602_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建作品时间线事件表，用于 API create/list 闭环。"""

    op.create_table(
        "timeline_events",
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("volume_id", sa.Integer(), nullable=False),
        sa.Column("chapter_id", sa.Integer(), nullable=False),
        sa.Column("time_order", sa.Integer(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("evidence_refs", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chapter_id"], ["chapters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_timeline_events_project_id"), "timeline_events", ["project_id"], unique=False)
    op.create_index(op.f("ix_timeline_events_book_id"), "timeline_events", ["book_id"], unique=False)
    op.create_index(op.f("ix_timeline_events_volume_id"), "timeline_events", ["volume_id"], unique=False)
    op.create_index(op.f("ix_timeline_events_chapter_id"), "timeline_events", ["chapter_id"], unique=False)
    op.create_index(op.f("ix_timeline_events_time_order"), "timeline_events", ["time_order"], unique=False)


def downgrade() -> None:
    """移除时间线事件表。"""

    op.drop_index(op.f("ix_timeline_events_time_order"), table_name="timeline_events")
    op.drop_index(op.f("ix_timeline_events_chapter_id"), table_name="timeline_events")
    op.drop_index(op.f("ix_timeline_events_volume_id"), table_name="timeline_events")
    op.drop_index(op.f("ix_timeline_events_book_id"), table_name="timeline_events")
    op.drop_index(op.f("ix_timeline_events_project_id"), table_name="timeline_events")
    op.drop_table("timeline_events")
