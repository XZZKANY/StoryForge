"""创建 Phase 1 领域模型

Revision ID: 71dfabf6badf
Revises: 
Create Date: 2026-05-12 19:22:09.513826
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '71dfabf6badf'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """升级到当前版本。"""
    # Alembic ?? SQLAlchemy ???????? Task 2 ??????
    op.create_table('books',
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=50), server_default='draft', nullable=False),
    sa.Column('premise', sa.Text(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('chapters',
    sa.Column('book_id', sa.Integer(), nullable=False),
    sa.Column('ordinal', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=50), server_default='planned', nullable=False),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_chapters_book_id'), 'chapters', ['book_id'], unique=False)
    op.create_table('scenes',
    sa.Column('chapter_id', sa.Integer(), nullable=False),
    sa.Column('ordinal', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=50), server_default='planned', nullable=False),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_scenes_chapter_id'), 'scenes', ['chapter_id'], unique=False)
    op.create_table('assets',
    sa.Column('book_id', sa.Integer(), nullable=False),
    sa.Column('scene_id', sa.Integer(), nullable=True),
    sa.Column('asset_type', sa.String(length=80), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('version', sa.Integer(), server_default='1', nullable=False),
    sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_assets_book_id'), 'assets', ['book_id'], unique=False)
    op.create_index(op.f('ix_assets_scene_id'), 'assets', ['scene_id'], unique=False)
    op.create_table('continuity_records',
    sa.Column('book_id', sa.Integer(), nullable=False),
    sa.Column('scene_id', sa.Integer(), nullable=True),
    sa.Column('record_type', sa.String(length=80), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('version', sa.Integer(), server_default='1', nullable=False),
    sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_continuity_records_book_id'), 'continuity_records', ['book_id'], unique=False)
    op.create_index(op.f('ix_continuity_records_scene_id'), 'continuity_records', ['scene_id'], unique=False)
    op.create_table('job_runs',
    sa.Column('book_id', sa.Integer(), nullable=True),
    sa.Column('scene_id', sa.Integer(), nullable=True),
    sa.Column('job_type', sa.String(length=80), nullable=False),
    sa.Column('status', sa.String(length=50), server_default='queued', nullable=False),
    sa.Column('progress', sa.JSON(), nullable=False),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_job_runs_book_id'), 'job_runs', ['book_id'], unique=False)
    op.create_index(op.f('ix_job_runs_scene_id'), 'job_runs', ['scene_id'], unique=False)
    op.create_table('evidence_links',
    sa.Column('asset_id', sa.Integer(), nullable=False),
    sa.Column('scene_id', sa.Integer(), nullable=True),
    sa.Column('job_run_id', sa.Integer(), nullable=True),
    sa.Column('evidence_type', sa.String(length=80), nullable=False),
    sa.Column('source_ref', sa.String(length=255), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['asset_id'], ['assets.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_evidence_links_asset_id'), 'evidence_links', ['asset_id'], unique=False)
    op.create_index(op.f('ix_evidence_links_job_run_id'), 'evidence_links', ['job_run_id'], unique=False)
    op.create_index(op.f('ix_evidence_links_scene_id'), 'evidence_links', ['scene_id'], unique=False)
    op.create_table('scene_packets',
    sa.Column('scene_id', sa.Integer(), nullable=False),
    sa.Column('job_run_id', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=50), server_default='assembled', nullable=False),
    sa.Column('packet', sa.JSON(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('version', sa.Integer(), server_default='1', nullable=False),
    sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_scene_packets_job_run_id'), 'scene_packets', ['job_run_id'], unique=False)
    op.create_index(op.f('ix_scene_packets_scene_id'), 'scene_packets', ['scene_id'], unique=False)
    op.create_table('judge_issues',
    sa.Column('scene_id', sa.Integer(), nullable=False),
    sa.Column('scene_packet_id', sa.Integer(), nullable=True),
    sa.Column('job_run_id', sa.Integer(), nullable=True),
    sa.Column('issue_type', sa.String(length=80), nullable=False),
    sa.Column('severity', sa.String(length=50), server_default='medium', nullable=False),
    sa.Column('status', sa.String(length=50), server_default='open', nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['scene_packet_id'], ['scene_packets.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_judge_issues_job_run_id'), 'judge_issues', ['job_run_id'], unique=False)
    op.create_index(op.f('ix_judge_issues_scene_id'), 'judge_issues', ['scene_id'], unique=False)
    op.create_index(op.f('ix_judge_issues_scene_packet_id'), 'judge_issues', ['scene_packet_id'], unique=False)
    op.create_table('repair_patches',
    sa.Column('judge_issue_id', sa.Integer(), nullable=False),
    sa.Column('scene_id', sa.Integer(), nullable=False),
    sa.Column('job_run_id', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=50), server_default='proposed', nullable=False),
    sa.Column('patch', sa.JSON(), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=True),
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('version', sa.Integer(), server_default='1', nullable=False),
    sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['judge_issue_id'], ['judge_issues.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_repair_patches_job_run_id'), 'repair_patches', ['job_run_id'], unique=False)
    op.create_index(op.f('ix_repair_patches_judge_issue_id'), 'repair_patches', ['judge_issue_id'], unique=False)
    op.create_index(op.f('ix_repair_patches_scene_id'), 'repair_patches', ['scene_id'], unique=False)
    # Alembic ???????


def downgrade() -> None:
    """回退当前版本。"""
    # Alembic ?? SQLAlchemy ???????? Task 2 ??????
    op.drop_index(op.f('ix_repair_patches_scene_id'), table_name='repair_patches')
    op.drop_index(op.f('ix_repair_patches_judge_issue_id'), table_name='repair_patches')
    op.drop_index(op.f('ix_repair_patches_job_run_id'), table_name='repair_patches')
    op.drop_table('repair_patches')
    op.drop_index(op.f('ix_judge_issues_scene_packet_id'), table_name='judge_issues')
    op.drop_index(op.f('ix_judge_issues_scene_id'), table_name='judge_issues')
    op.drop_index(op.f('ix_judge_issues_job_run_id'), table_name='judge_issues')
    op.drop_table('judge_issues')
    op.drop_index(op.f('ix_scene_packets_scene_id'), table_name='scene_packets')
    op.drop_index(op.f('ix_scene_packets_job_run_id'), table_name='scene_packets')
    op.drop_table('scene_packets')
    op.drop_index(op.f('ix_evidence_links_scene_id'), table_name='evidence_links')
    op.drop_index(op.f('ix_evidence_links_job_run_id'), table_name='evidence_links')
    op.drop_index(op.f('ix_evidence_links_asset_id'), table_name='evidence_links')
    op.drop_table('evidence_links')
    op.drop_index(op.f('ix_job_runs_scene_id'), table_name='job_runs')
    op.drop_index(op.f('ix_job_runs_book_id'), table_name='job_runs')
    op.drop_table('job_runs')
    op.drop_index(op.f('ix_continuity_records_scene_id'), table_name='continuity_records')
    op.drop_index(op.f('ix_continuity_records_book_id'), table_name='continuity_records')
    op.drop_table('continuity_records')
    op.drop_index(op.f('ix_assets_scene_id'), table_name='assets')
    op.drop_index(op.f('ix_assets_book_id'), table_name='assets')
    op.drop_table('assets')
    op.drop_index(op.f('ix_scenes_chapter_id'), table_name='scenes')
    op.drop_table('scenes')
    op.drop_index(op.f('ix_chapters_book_id'), table_name='chapters')
    op.drop_table('chapters')
    op.drop_table('books')
    # Alembic ???????
