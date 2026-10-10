"""Drop the 37 tables left behind by the retired domains.

2026-10：桌面端是唯一客户端，其 HTTP 面只剩 `/api/agent-runs`、`/api/assistant`、`/api/ide`
（加 `/health`）。随 #274 卸 router、#277 删死服务层、#278 删 DB 实体审稿链之后，这些表
**在 live 导入闭包里只剩 `models.py` 一条边**（闭包由 `app.main` 静态算出，全仓零 importlib
动态导入），且在作者用了数月的装机版库里**全部 0 行**。本刀把模型与表一并删除，
ORM 注册表 44 → 7。

DROP 顺序按外键依赖倒排（子表在前），以便在 PG 上也成立；SQLite 侧 `DROP TABLE` 不校验外键。
downgrade 按父表在前的顺序重建这 37 张表。建表定义由删除前的 ORM 元数据**生成**而非手抄，
时间戳默认值统一用 `sa.func.now()` 保持方言中立（SQLite 不认 PG 的 `now()` 字面量）。
往返由 `test_sqlite_migrations.py::test_downgrade_roundtrip_on_latest_migration` 实跑钉死。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "20261010_0002"
down_revision: str | None = "20261010_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 子表在前；同层按名字排序以保证可复现。
_DROP_ORDER = (
    "workspace_subscriptions",
    "workspace_comments",
    "timeline_events",
    "story_state_ledgers",
    "story_state_events",
    "series_memory_evidence",
    "series_memories",
    "retrieval_refresh_runs",
    "retrieval_chunks",
    "retrieval_sources",
    "series",
    "repair_patches",
    "provider_configs",
    "model_runs",
    "prompt_packs",
    "memory_atoms",
    "judge_issues",
    "scene_packets",
    "evidence_links",
    "job_runs",
    "event_logs",
    "evaluation_runs",
    "evaluation_cases",
    "continuity_records",
    "continuity_edges",
    "compiled_contexts",
    "character_bible_entries",
    "assets",
    "artifacts",
    "approval_decisions",
    "approval_requests",
    "workspace_members",
    "scenes",
    "chapters",
    "book_blueprints",
    "books",
    "workspaces",
)


def _existing_tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    # offline（--sql）拿不到真连接，一律发 DDL；在线则按实际存在情况跳过，
    # 兼容 create_all 建的新库（这些表从一开始就不存在）。
    offline = context.is_offline_mode()
    present = set() if offline else _existing_tables()
    for table in _DROP_ORDER:
        if offline or table in present:
            op.drop_table(table)


def downgrade() -> None:
    op.create_table(
        'workspaces',
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('slug', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('seat_limit', sa.Integer(), server_default='1', nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspaces_slug', 'workspaces', ['slug'], unique=True)
    op.create_table(
        'books',
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='draft', nullable=False),
        sa.Column('premise', sa.Text(), nullable=True),
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_books_workspace_id', 'books', ['workspace_id'], unique=False)
    op.create_table(
        'book_blueprints',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('premise', sa.Text(), nullable=False),
        sa.Column('tone', sa.String(length=255), nullable=False),
        sa.Column('target_word_count', sa.Integer(), nullable=False),
        sa.Column('target_chapter_count', sa.Integer(), nullable=False),
        sa.Column('chapter_word_count_min', sa.Integer(), nullable=False),
        sa.Column('chapter_word_count_max', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='draft', nullable=False),
        sa.Column('metadata', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_book_blueprints_book_id', 'book_blueprints', ['book_id'], unique=False)
    op.create_table(
        'chapters',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='planned', nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('blueprint_id', sa.Integer(), nullable=True),
        sa.Column('planning_source', sa.String(length=80), nullable=True),
        sa.Column('pov', sa.String(length=120), nullable=True),
        sa.Column('location', sa.String(length=255), nullable=True),
        sa.Column('required_beats', sa.JSON(), nullable=False),
        sa.Column('expected_word_count', sa.Integer(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['blueprint_id'], ['book_blueprints.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_chapters_blueprint_id', 'chapters', ['blueprint_id'], unique=False)
    op.create_index('ix_chapters_book_id', 'chapters', ['book_id'], unique=False)
    op.create_table(
        'scenes',
        sa.Column('chapter_id', sa.Integer(), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='planned', nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scenes_chapter_id', 'scenes', ['chapter_id'], unique=False)
    op.create_table(
        'workspace_members',
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=50), server_default='editor', nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspace_members_workspace_id', 'workspace_members', ['workspace_id'], unique=False)
    op.create_table(
        'approval_requests',
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        sa.Column('scene_id', sa.Integer(), nullable=False),
        sa.Column('requester_member_id', sa.Integer(), nullable=False),
        sa.Column('reviewer_member_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='pending', nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['requester_member_id'], ['workspace_members.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewer_member_id'], ['workspace_members.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_approval_requests_requester_member_id', 'approval_requests', ['requester_member_id'], unique=False)
    op.create_index('ix_approval_requests_reviewer_member_id', 'approval_requests', ['reviewer_member_id'], unique=False)
    op.create_index('ix_approval_requests_scene_id', 'approval_requests', ['scene_id'], unique=False)
    op.create_index('ix_approval_requests_workspace_id', 'approval_requests', ['workspace_id'], unique=False)
    op.create_table(
        'approval_decisions',
        sa.Column('approval_request_id', sa.Integer(), nullable=False),
        sa.Column('member_id', sa.Integer(), nullable=False),
        sa.Column('decision', sa.String(length=50), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['approval_request_id'], ['approval_requests.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['member_id'], ['workspace_members.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_approval_decisions_approval_request_id', 'approval_decisions', ['approval_request_id'], unique=False)
    op.create_index('ix_approval_decisions_member_id', 'approval_decisions', ['member_id'], unique=False)
    op.create_table(
        'artifacts',
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('artifact_type', sa.String(length=80), nullable=False),
        sa.Column('lineage_key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('storage_uri', sa.String(length=255), nullable=False),
        sa.Column('mime_type', sa.String(length=120), nullable=False),
        sa.Column('size_bytes', sa.Integer(), server_default='0', nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_artifacts_book_id', 'artifacts', ['book_id'], unique=False)
    op.create_index('ix_artifacts_lineage_key', 'artifacts', ['lineage_key'], unique=False)
    op.create_index('ix_artifacts_workspace_id', 'artifacts', ['workspace_id'], unique=False)
    op.create_table(
        'assets',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('scene_id', sa.Integer(), nullable=True),
        sa.Column('asset_type', sa.String(length=80), nullable=False),
        sa.Column('lineage_key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_assets_book_id', 'assets', ['book_id'], unique=False)
    op.create_index('ix_assets_lineage_key', 'assets', ['lineage_key'], unique=False)
    op.create_index('ix_assets_scene_id', 'assets', ['scene_id'], unique=False)
    op.create_table(
        'character_bible_entries',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('character_id', sa.Integer(), nullable=True),
        sa.Column('lineage_key', sa.String(length=80), nullable=False),
        sa.Column('canonical_name', sa.String(length=255), nullable=False),
        sa.Column('aliases', sa.JSON(), nullable=False),
        sa.Column('voice_traits', sa.JSON(), nullable=False),
        sa.Column('forbidden_traits', sa.JSON(), nullable=False),
        sa.Column('sync_status', sa.String(length=50), server_default='pending', nullable=False),
        sa.Column('memory_atom_id', sa.String(length=80), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['character_id'], ['assets.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_character_bible_entries_book_id', 'character_bible_entries', ['book_id'], unique=False)
    op.create_index('ix_character_bible_entries_canonical_name', 'character_bible_entries', ['canonical_name'], unique=False)
    op.create_index('ix_character_bible_entries_character_id', 'character_bible_entries', ['character_id'], unique=False)
    op.create_index('ix_character_bible_entries_lineage_key', 'character_bible_entries', ['lineage_key'], unique=False)
    op.create_table(
        'compiled_contexts',
        sa.Column('compiled_context_id', sa.String(length=80), nullable=False),
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('chapter_id', sa.Integer(), nullable=False),
        sa.Column('scene_id', sa.Integer(), nullable=False),
        sa.Column('token_budget', sa.Integer(), nullable=False),
        sa.Column('used_tokens', sa.Integer(), nullable=False),
        sa.Column('dropped_tokens', sa.Integer(), server_default='0', nullable=False),
        sa.Column('injected_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('dropped_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('block_refs', sa.JSON(), nullable=False),
        sa.Column('budget_report', sa.JSON(), nullable=False),
        sa.Column('debug_summary', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_compiled_contexts_book_id', 'compiled_contexts', ['book_id'], unique=False)
    op.create_index('ix_compiled_contexts_chapter_id', 'compiled_contexts', ['chapter_id'], unique=False)
    op.create_index('ix_compiled_contexts_compiled_context_id', 'compiled_contexts', ['compiled_context_id'], unique=True)
    op.create_index('ix_compiled_contexts_scene_id', 'compiled_contexts', ['scene_id'], unique=False)
    op.create_table(
        'continuity_edges',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('edge_kind', sa.String(length=40), nullable=False),
        sa.Column('subject_ref', sa.String(length=160), nullable=False),
        sa.Column('predicate', sa.String(length=80), nullable=False),
        sa.Column('object_ref', sa.String(length=160), nullable=False),
        sa.Column('valid_from_chapter', sa.Integer(), server_default='1', nullable=False),
        sa.Column('valid_to_chapter', sa.Integer(), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_continuity_edges_book_id', 'continuity_edges', ['book_id'], unique=False)
    op.create_index('ix_continuity_edges_edge_kind', 'continuity_edges', ['edge_kind'], unique=False)
    op.create_table(
        'continuity_records',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('scene_id', sa.Integer(), nullable=True),
        sa.Column('record_type', sa.String(length=80), nullable=False),
        sa.Column('subject', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_continuity_records_book_id', 'continuity_records', ['book_id'], unique=False)
    op.create_index('ix_continuity_records_scene_id', 'continuity_records', ['scene_id'], unique=False)
    op.create_table(
        'evaluation_cases',
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('case_name', sa.String(length=255), nullable=False),
        sa.Column('case_type', sa.String(length=80), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('input_payload', sa.JSON(), nullable=False),
        sa.Column('expected_payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_evaluation_cases_book_id', 'evaluation_cases', ['book_id'], unique=False)
    op.create_index('ix_evaluation_cases_workspace_id', 'evaluation_cases', ['workspace_id'], unique=False)
    op.create_table(
        'evaluation_runs',
        sa.Column('case_id', sa.Integer(), nullable=True),
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), server_default='completed', nullable=False),
        sa.Column('metrics', sa.JSON(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['case_id'], ['evaluation_cases.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_evaluation_runs_book_id', 'evaluation_runs', ['book_id'], unique=False)
    op.create_index('ix_evaluation_runs_case_id', 'evaluation_runs', ['case_id'], unique=False)
    op.create_index('ix_evaluation_runs_workspace_id', 'evaluation_runs', ['workspace_id'], unique=False)
    op.create_table(
        'event_logs',
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('scene_id', sa.Integer(), nullable=True),
        sa.Column('member_id', sa.Integer(), nullable=True),
        sa.Column('event_type', sa.String(length=80), nullable=False),
        sa.Column('source', sa.String(length=80), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['member_id'], ['workspace_members.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_event_logs_book_id', 'event_logs', ['book_id'], unique=False)
    op.create_index('ix_event_logs_member_id', 'event_logs', ['member_id'], unique=False)
    op.create_index('ix_event_logs_scene_id', 'event_logs', ['scene_id'], unique=False)
    op.create_index('ix_event_logs_workspace_id', 'event_logs', ['workspace_id'], unique=False)
    op.create_table(
        'job_runs',
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('scene_id', sa.Integer(), nullable=True),
        sa.Column('job_type', sa.String(length=80), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='queued', nullable=False),
        sa.Column('progress', sa.JSON(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_job_runs_book_id', 'job_runs', ['book_id'], unique=False)
    op.create_index('ix_job_runs_scene_id', 'job_runs', ['scene_id'], unique=False)
    op.create_table(
        'evidence_links',
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('scene_id', sa.Integer(), nullable=True),
        sa.Column('job_run_id', sa.Integer(), nullable=True),
        sa.Column('evidence_type', sa.String(length=80), nullable=False),
        sa.Column('source_ref', sa.String(length=255), nullable=False),
        sa.Column('rationale', sa.Text(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['asset_id'], ['assets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_evidence_links_asset_id', 'evidence_links', ['asset_id'], unique=False)
    op.create_index('ix_evidence_links_job_run_id', 'evidence_links', ['job_run_id'], unique=False)
    op.create_index('ix_evidence_links_scene_id', 'evidence_links', ['scene_id'], unique=False)
    op.create_table(
        'scene_packets',
        sa.Column('scene_id', sa.Integer(), nullable=False),
        sa.Column('job_run_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), server_default='assembled', nullable=False),
        sa.Column('packet', sa.JSON(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scene_packets_job_run_id', 'scene_packets', ['job_run_id'], unique=False)
    op.create_index('ix_scene_packets_scene_id', 'scene_packets', ['scene_id'], unique=False)
    op.create_table(
        'judge_issues',
        sa.Column('scene_id', sa.Integer(), nullable=False),
        sa.Column('scene_packet_id', sa.Integer(), nullable=True),
        sa.Column('job_run_id', sa.Integer(), nullable=True),
        sa.Column('issue_type', sa.String(length=80), nullable=False),
        sa.Column('severity', sa.String(length=50), server_default='medium', nullable=False),
        sa.Column('status', sa.String(length=50), server_default='open', nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_packet_id'], ['scene_packets.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_judge_issues_job_run_id', 'judge_issues', ['job_run_id'], unique=False)
    op.create_index('ix_judge_issues_scene_id', 'judge_issues', ['scene_id'], unique=False)
    op.create_index('ix_judge_issues_scene_packet_id', 'judge_issues', ['scene_packet_id'], unique=False)
    op.create_table(
        'memory_atoms',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('entity_type', sa.String(length=80), nullable=False),
        sa.Column('entity_id', sa.String(length=160), nullable=False),
        sa.Column('fact_type', sa.String(length=80), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('valid_from_chapter', sa.Integer(), server_default='1', nullable=False),
        sa.Column('valid_to_chapter', sa.Integer(), nullable=True),
        sa.Column('immutable', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('confidence', sa.Float(), server_default='1', nullable=False),
        sa.Column('revision', sa.Integer(), server_default='1', nullable=False),
        sa.Column('embedding', sa.JSON(), nullable=False),
        sa.Column('source_ref', sa.String(length=255), nullable=False),
        sa.Column('source_chapter_id', sa.Integer(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_chapter_id'], ['chapters.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_memory_atoms_book_id', 'memory_atoms', ['book_id'], unique=False)
    op.create_index('ix_memory_atoms_entity_id', 'memory_atoms', ['entity_id'], unique=False)
    op.create_index('ix_memory_atoms_entity_type', 'memory_atoms', ['entity_type'], unique=False)
    op.create_index('ix_memory_atoms_fact_type', 'memory_atoms', ['fact_type'], unique=False)
    op.create_index('ix_memory_atoms_source_chapter_id', 'memory_atoms', ['source_chapter_id'], unique=False)
    op.create_table(
        'prompt_packs',
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('pack_type', sa.String(length=80), nullable=False),
        sa.Column('lineage_key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_prompt_packs_book_id', 'prompt_packs', ['book_id'], unique=False)
    op.create_index('ix_prompt_packs_lineage_key', 'prompt_packs', ['lineage_key'], unique=False)
    op.create_index('ix_prompt_packs_workspace_id', 'prompt_packs', ['workspace_id'], unique=False)
    op.create_table(
        'model_runs',
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('chapter_id', sa.Integer(), nullable=True),
        sa.Column('scene_id', sa.Integer(), nullable=True),
        sa.Column('job_run_id', sa.Integer(), nullable=True),
        sa.Column('prompt_pack_id', sa.Integer(), nullable=True),
        sa.Column('provider_name', sa.String(length=80), nullable=False),
        sa.Column('model_name', sa.String(length=120), nullable=False),
        sa.Column('capability', sa.String(length=80), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='completed', nullable=False),
        sa.Column('latency_ms', sa.Integer(), server_default='0', nullable=False),
        sa.Column('token_usage', sa.Integer(), server_default='0', nullable=False),
        sa.Column('input_tokens', sa.Integer(), server_default='0', nullable=False),
        sa.Column('output_tokens', sa.Integer(), server_default='0', nullable=False),
        sa.Column('cost_estimate', sa.Float(), server_default='0', nullable=False),
        sa.Column('finish_reason', sa.String(length=80), nullable=True),
        sa.Column('error_kind', sa.String(length=80), nullable=True),
        sa.Column('retry_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('repair_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('prompt_template_version', sa.String(length=120), nullable=True),
        sa.Column('prompt_hash', sa.String(length=128), nullable=True),
        sa.Column('input_summary', sa.Text(), nullable=False),
        sa.Column('output_summary', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['prompt_pack_id'], ['prompt_packs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_model_runs_book_id', 'model_runs', ['book_id'], unique=False)
    op.create_index('ix_model_runs_chapter_id', 'model_runs', ['chapter_id'], unique=False)
    op.create_index('ix_model_runs_error_kind', 'model_runs', ['error_kind'], unique=False)
    op.create_index('ix_model_runs_job_run_id', 'model_runs', ['job_run_id'], unique=False)
    op.create_index('ix_model_runs_prompt_hash', 'model_runs', ['prompt_hash'], unique=False)
    op.create_index('ix_model_runs_prompt_pack_id', 'model_runs', ['prompt_pack_id'], unique=False)
    op.create_index('ix_model_runs_scene_id', 'model_runs', ['scene_id'], unique=False)
    op.create_index('ix_model_runs_workspace_id', 'model_runs', ['workspace_id'], unique=False)
    op.create_table(
        'provider_configs',
        sa.Column('workspace_id', sa.Integer(), nullable=True),
        sa.Column('provider_name', sa.String(length=80), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('priority', sa.Integer(), server_default='100', nullable=False),
        sa.Column('capabilities', sa.JSON(), nullable=False),
        sa.Column('model_aliases', sa.JSON(), nullable=False),
        sa.Column('credential_ref', sa.String(length=255), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_provider_configs_workspace_id', 'provider_configs', ['workspace_id'], unique=False)
    op.create_table(
        'repair_patches',
        sa.Column('judge_issue_id', sa.Integer(), nullable=False),
        sa.Column('scene_id', sa.Integer(), nullable=False),
        sa.Column('job_run_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), server_default='proposed', nullable=False),
        sa.Column('patch', sa.JSON(), nullable=False),
        sa.Column('rationale', sa.Text(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['job_run_id'], ['job_runs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['judge_issue_id'], ['judge_issues.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_repair_patches_job_run_id', 'repair_patches', ['job_run_id'], unique=False)
    op.create_index('ix_repair_patches_judge_issue_id', 'repair_patches', ['judge_issue_id'], unique=False)
    op.create_index('ix_repair_patches_scene_id', 'repair_patches', ['scene_id'], unique=False)
    op.create_table(
        'series',
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'retrieval_sources',
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('series_id', sa.Integer(), nullable=True),
        sa.Column('source_type', sa.String(length=80), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('content_text', sa.Text(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['series_id'], ['series.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_retrieval_sources_book_id', 'retrieval_sources', ['book_id'], unique=False)
    op.create_index('ix_retrieval_sources_series_id', 'retrieval_sources', ['series_id'], unique=False)
    op.create_table(
        'retrieval_chunks',
        sa.Column('source_id', sa.Integer(), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('token_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('keywords', sa.JSON(), nullable=False),
        sa.Column('embedding', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['source_id'], ['retrieval_sources.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_retrieval_chunks_source_id', 'retrieval_chunks', ['source_id'], unique=False)
    op.create_table(
        'retrieval_refresh_runs',
        sa.Column('source_id', sa.Integer(), nullable=True),
        sa.Column('book_id', sa.Integer(), nullable=True),
        sa.Column('series_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), server_default='completed', nullable=False),
        sa.Column('chunk_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['series_id'], ['series.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['source_id'], ['retrieval_sources.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_retrieval_refresh_runs_book_id', 'retrieval_refresh_runs', ['book_id'], unique=False)
    op.create_index('ix_retrieval_refresh_runs_series_id', 'retrieval_refresh_runs', ['series_id'], unique=False)
    op.create_index('ix_retrieval_refresh_runs_source_id', 'retrieval_refresh_runs', ['source_id'], unique=False)
    op.create_table(
        'series_memories',
        sa.Column('series_id', sa.Integer(), nullable=False),
        sa.Column('memory_type', sa.String(length=80), nullable=False),
        sa.Column('lineage_key', sa.String(length=80), nullable=False),
        sa.Column('subject', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['series_id'], ['series.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_series_memories_lineage_key', 'series_memories', ['lineage_key'], unique=False)
    op.create_index('ix_series_memories_series_id', 'series_memories', ['series_id'], unique=False)
    op.create_table(
        'series_memory_evidence',
        sa.Column('memory_id', sa.Integer(), nullable=False),
        sa.Column('evidence_type', sa.String(length=80), nullable=False),
        sa.Column('source_ref', sa.String(length=255), nullable=False),
        sa.Column('rationale', sa.Text(), nullable=True),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['memory_id'], ['series_memories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_series_memory_evidence_memory_id', 'series_memory_evidence', ['memory_id'], unique=False)
    op.create_table(
        'story_state_events',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('chapter_index', sa.Integer(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('change_type', sa.String(length=80), nullable=False),
        sa.Column('entity_kind', sa.String(length=80), nullable=False),
        sa.Column('entity_id', sa.String(length=160), nullable=False),
        sa.Column('object_id', sa.String(length=160), nullable=True),
        sa.Column('payload', sa.JSON(), server_default='{}', nullable=False),
        sa.Column('grounding', sa.JSON(), server_default='{}', nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_story_state_events_book_id', 'story_state_events', ['book_id'], unique=False)
    op.create_index('ix_story_state_events_change_type', 'story_state_events', ['change_type'], unique=False)
    op.create_index('ix_story_state_events_chapter_index', 'story_state_events', ['chapter_index'], unique=False)
    op.create_index('ix_story_state_events_entity_id', 'story_state_events', ['entity_id'], unique=False)
    op.create_index('ix_story_state_events_entity_kind', 'story_state_events', ['entity_kind'], unique=False)
    op.create_index('ix_story_state_events_object_id', 'story_state_events', ['object_id'], unique=False)
    op.create_table(
        'story_state_ledgers',
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('entity_kind', sa.String(length=80), nullable=False),
        sa.Column('entity_id', sa.String(length=160), nullable=False),
        sa.Column('canonical_name', sa.String(length=255), nullable=False),
        sa.Column('aliases', sa.JSON(), server_default='[]', nullable=False),
        sa.Column('state', sa.JSON(), server_default='{}', nullable=False),
        sa.Column('last_chapter', sa.Integer(), server_default='1', nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('book_id', 'entity_kind', 'entity_id', name='uq_story_state_ledgers_scope_entity'),
    )
    op.create_index('ix_story_state_ledgers_book_id', 'story_state_ledgers', ['book_id'], unique=False)
    op.create_index('ix_story_state_ledgers_entity_id', 'story_state_ledgers', ['entity_id'], unique=False)
    op.create_index('ix_story_state_ledgers_entity_kind', 'story_state_ledgers', ['entity_kind'], unique=False)
    op.create_table(
        'timeline_events',
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('book_id', sa.Integer(), nullable=False),
        sa.Column('volume_id', sa.Integer(), nullable=False),
        sa.Column('chapter_id', sa.Integer(), nullable=False),
        sa.Column('time_order', sa.Integer(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('evidence_refs', sa.JSON(), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_timeline_events_book_id', 'timeline_events', ['book_id'], unique=False)
    op.create_index('ix_timeline_events_chapter_id', 'timeline_events', ['chapter_id'], unique=False)
    op.create_index('ix_timeline_events_project_id', 'timeline_events', ['project_id'], unique=False)
    op.create_index('ix_timeline_events_time_order', 'timeline_events', ['time_order'], unique=False)
    op.create_index('ix_timeline_events_volume_id', 'timeline_events', ['volume_id'], unique=False)
    op.create_table(
        'workspace_comments',
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        sa.Column('scene_id', sa.Integer(), nullable=False),
        sa.Column('member_id', sa.Integer(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='open', nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['member_id'], ['workspace_members.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['scene_id'], ['scenes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspace_comments_member_id', 'workspace_comments', ['member_id'], unique=False)
    op.create_index('ix_workspace_comments_scene_id', 'workspace_comments', ['scene_id'], unique=False)
    op.create_index('ix_workspace_comments_workspace_id', 'workspace_comments', ['workspace_id'], unique=False)
    op.create_table(
        'workspace_subscriptions',
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        sa.Column('plan_code', sa.String(length=80), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='active', nullable=False),
        sa.Column('seat_limit', sa.Integer(), server_default='1', nullable=False),
        sa.Column('monthly_job_limit', sa.Integer(), server_default='0', nullable=False),
        sa.Column('monthly_token_limit', sa.Integer(), server_default='0', nullable=False),
        sa.Column('monthly_price', sa.Numeric(), nullable=False),
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspace_subscriptions_workspace_id', 'workspace_subscriptions', ['workspace_id'], unique=False)
