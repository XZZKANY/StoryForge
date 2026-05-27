"""补齐当前 ORM 与历史迁移之间的 schema 缺口。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision: str = "20260528_0001"
down_revision: str | None = "20260527_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_exists(table_name: str) -> bool:
    """检查表是否已存在，兼容被本地补表过的开发库。"""

    return inspect(op.get_bind()).has_table(table_name)


def _column_exists(table_name: str, column_name: str) -> bool:
    """检查列是否已存在，避免重复添加非破坏性补齐列。"""

    if not _table_exists(table_name):
        return False
    columns = inspect(op.get_bind()).get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def _index_exists(table_name: str, index_name: str) -> bool:
    """检查索引是否已存在，保持迁移可在旧开发库重复安全执行。"""

    if not _table_exists(table_name):
        return False
    indexes = inspect(op.get_bind()).get_indexes(table_name)
    return any(index["name"] == index_name for index in indexes)


def _fk_exists(table_name: str, fk_name: str) -> bool:
    """检查外键约束是否已存在。"""

    if not _table_exists(table_name):
        return False
    foreign_keys = inspect(op.get_bind()).get_foreign_keys(table_name)
    return any(foreign_key.get("name") == fk_name for foreign_key in foreign_keys)


def _create_index_once(index_name: str, table_name: str, columns: list[str], *, unique: bool = False) -> None:
    """只在缺失时创建索引。"""

    if not _index_exists(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def _create_fk_once(
    fk_name: str,
    source_table: str,
    referent_table: str,
    local_cols: list[str],
    remote_cols: list[str],
    *,
    ondelete: str,
) -> None:
    """只在缺失时创建外键约束。"""

    if not _fk_exists(source_table, fk_name):
        op.create_foreign_key(fk_name, source_table, referent_table, local_cols, remote_cols, ondelete=ondelete)


def upgrade() -> None:
    """追加历史迁移遗漏的当前 ORM 表结构。"""

    if not _table_exists("series"):
        op.create_table(
            "series",
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _table_exists("workspaces"):
        op.create_table(
            "workspaces",
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("seat_limit", sa.Integer(), server_default="1", nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_workspaces_slug", "workspaces", ["slug"], unique=True)

    if not _column_exists("books", "workspace_id"):
        op.add_column("books", sa.Column("workspace_id", sa.Integer(), nullable=True))
    _create_index_once("ix_books_workspace_id", "books", ["workspace_id"])
    _create_fk_once(
        "fk_books_workspace_id_workspaces",
        "books",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )

    if not _table_exists("workspace_members"):
        op.create_table(
            "workspace_members",
            sa.Column("workspace_id", sa.Integer(), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column("role", sa.String(length=50), server_default="editor", nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_workspace_members_workspace_id", "workspace_members", ["workspace_id"])

    if not _table_exists("workspace_subscriptions"):
        op.create_table(
            "workspace_subscriptions",
            sa.Column("workspace_id", sa.Integer(), nullable=False),
            sa.Column("plan_code", sa.String(length=80), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("seat_limit", sa.Integer(), server_default="1", nullable=False),
            sa.Column("monthly_job_limit", sa.Integer(), server_default="0", nullable=False),
            sa.Column("monthly_token_limit", sa.Integer(), server_default="0", nullable=False),
            sa.Column("monthly_price", sa.Numeric(10, 2), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_workspace_subscriptions_workspace_id", "workspace_subscriptions", ["workspace_id"])

    if not _table_exists("provider_configs"):
        op.create_table(
            "provider_configs",
            sa.Column("workspace_id", sa.Integer(), nullable=True),
            sa.Column("provider_name", sa.String(length=80), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("priority", sa.Integer(), server_default="100", nullable=False),
            sa.Column("capabilities", sa.JSON(), nullable=False),
            sa.Column("model_aliases", sa.JSON(), nullable=False),
            sa.Column("credential_ref", sa.String(length=255), nullable=True),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_provider_configs_workspace_id", "provider_configs", ["workspace_id"])

    if not _table_exists("series_memories"):
        op.create_table(
            "series_memories",
            sa.Column("series_id", sa.Integer(), nullable=False),
            sa.Column("memory_type", sa.String(length=80), nullable=False),
            sa.Column("lineage_key", sa.String(length=80), nullable=False),
            sa.Column("subject", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_series_memories_series_id", "series_memories", ["series_id"])
    _create_index_once("ix_series_memories_lineage_key", "series_memories", ["lineage_key"])

    if not _table_exists("artifacts"):
        op.create_table(
            "artifacts",
            sa.Column("workspace_id", sa.Integer(), nullable=True),
            sa.Column("book_id", sa.Integer(), nullable=True),
            sa.Column("artifact_type", sa.String(length=80), nullable=False),
            sa.Column("lineage_key", sa.String(length=80), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("storage_uri", sa.String(length=255), nullable=False),
            sa.Column("mime_type", sa.String(length=120), nullable=False),
            sa.Column("size_bytes", sa.Integer(), server_default="0", nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_artifacts_workspace_id", "artifacts", ["workspace_id"])
    _create_index_once("ix_artifacts_book_id", "artifacts", ["book_id"])
    _create_index_once("ix_artifacts_lineage_key", "artifacts", ["lineage_key"])

    if not _table_exists("evaluation_cases"):
        op.create_table(
            "evaluation_cases",
            sa.Column("workspace_id", sa.Integer(), nullable=True),
            sa.Column("book_id", sa.Integer(), nullable=True),
            sa.Column("case_name", sa.String(length=255), nullable=False),
            sa.Column("case_type", sa.String(length=80), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("input_payload", sa.JSON(), nullable=False),
            sa.Column("expected_payload", sa.JSON(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_evaluation_cases_workspace_id", "evaluation_cases", ["workspace_id"])
    _create_index_once("ix_evaluation_cases_book_id", "evaluation_cases", ["book_id"])

    if not _table_exists("prompt_packs"):
        op.create_table(
            "prompt_packs",
            sa.Column("workspace_id", sa.Integer(), nullable=True),
            sa.Column("book_id", sa.Integer(), nullable=True),
            sa.Column("pack_type", sa.String(length=80), nullable=False),
            sa.Column("lineage_key", sa.String(length=80), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="active", nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_prompt_packs_workspace_id", "prompt_packs", ["workspace_id"])
    _create_index_once("ix_prompt_packs_book_id", "prompt_packs", ["book_id"])
    _create_index_once("ix_prompt_packs_lineage_key", "prompt_packs", ["lineage_key"])

    if not _table_exists("series_memory_evidence"):
        op.create_table(
            "series_memory_evidence",
            sa.Column("memory_id", sa.Integer(), nullable=False),
            sa.Column("evidence_type", sa.String(length=80), nullable=False),
            sa.Column("source_ref", sa.String(length=255), nullable=False),
            sa.Column("rationale", sa.Text(), nullable=True),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["memory_id"], ["series_memories.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_series_memory_evidence_memory_id", "series_memory_evidence", ["memory_id"])

    if not _table_exists("evaluation_runs"):
        op.create_table(
            "evaluation_runs",
            sa.Column("case_id", sa.Integer(), nullable=True),
            sa.Column("workspace_id", sa.Integer(), nullable=True),
            sa.Column("book_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=50), server_default="completed", nullable=False),
            sa.Column("metrics", sa.JSON(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["case_id"], ["evaluation_cases.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_evaluation_runs_case_id", "evaluation_runs", ["case_id"])
    _create_index_once("ix_evaluation_runs_workspace_id", "evaluation_runs", ["workspace_id"])
    _create_index_once("ix_evaluation_runs_book_id", "evaluation_runs", ["book_id"])

    if not _table_exists("workspace_comments"):
        op.create_table(
            "workspace_comments",
            sa.Column("workspace_id", sa.Integer(), nullable=False),
            sa.Column("scene_id", sa.Integer(), nullable=False),
            sa.Column("member_id", sa.Integer(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="open", nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["member_id"], ["workspace_members.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_workspace_comments_workspace_id", "workspace_comments", ["workspace_id"])
    _create_index_once("ix_workspace_comments_scene_id", "workspace_comments", ["scene_id"])
    _create_index_once("ix_workspace_comments_member_id", "workspace_comments", ["member_id"])

    if not _table_exists("approval_requests"):
        op.create_table(
            "approval_requests",
            sa.Column("workspace_id", sa.Integer(), nullable=False),
            sa.Column("scene_id", sa.Integer(), nullable=False),
            sa.Column("requester_member_id", sa.Integer(), nullable=False),
            sa.Column("reviewer_member_id", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="pending", nullable=False),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["requester_member_id"], ["workspace_members.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["reviewer_member_id"], ["workspace_members.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_approval_requests_workspace_id", "approval_requests", ["workspace_id"])
    _create_index_once("ix_approval_requests_scene_id", "approval_requests", ["scene_id"])
    _create_index_once("ix_approval_requests_requester_member_id", "approval_requests", ["requester_member_id"])
    _create_index_once("ix_approval_requests_reviewer_member_id", "approval_requests", ["reviewer_member_id"])

    if not _table_exists("event_logs"):
        op.create_table(
            "event_logs",
            sa.Column("workspace_id", sa.Integer(), nullable=False),
            sa.Column("book_id", sa.Integer(), nullable=True),
            sa.Column("scene_id", sa.Integer(), nullable=True),
            sa.Column("member_id", sa.Integer(), nullable=True),
            sa.Column("event_type", sa.String(length=80), nullable=False),
            sa.Column("source", sa.String(length=80), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["member_id"], ["workspace_members.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_event_logs_workspace_id", "event_logs", ["workspace_id"])
    _create_index_once("ix_event_logs_book_id", "event_logs", ["book_id"])
    _create_index_once("ix_event_logs_scene_id", "event_logs", ["scene_id"])
    _create_index_once("ix_event_logs_member_id", "event_logs", ["member_id"])

    if not _table_exists("model_runs"):
        op.create_table(
            "model_runs",
            sa.Column("workspace_id", sa.Integer(), nullable=True),
            sa.Column("book_id", sa.Integer(), nullable=True),
            sa.Column("scene_id", sa.Integer(), nullable=True),
            sa.Column("job_run_id", sa.Integer(), nullable=True),
            sa.Column("prompt_pack_id", sa.Integer(), nullable=True),
            sa.Column("provider_name", sa.String(length=80), nullable=False),
            sa.Column("model_name", sa.String(length=120), nullable=False),
            sa.Column("capability", sa.String(length=80), nullable=False),
            sa.Column("status", sa.String(length=50), server_default="completed", nullable=False),
            sa.Column("latency_ms", sa.Integer(), server_default="0", nullable=False),
            sa.Column("token_usage", sa.Integer(), server_default="0", nullable=False),
            sa.Column("input_summary", sa.Text(), nullable=False),
            sa.Column("output_summary", sa.Text(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["job_run_id"], ["job_runs.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["prompt_pack_id"], ["prompt_packs.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_model_runs_workspace_id", "model_runs", ["workspace_id"])
    _create_index_once("ix_model_runs_book_id", "model_runs", ["book_id"])
    _create_index_once("ix_model_runs_scene_id", "model_runs", ["scene_id"])
    _create_index_once("ix_model_runs_job_run_id", "model_runs", ["job_run_id"])
    _create_index_once("ix_model_runs_prompt_pack_id", "model_runs", ["prompt_pack_id"])

    if not _table_exists("approval_decisions"):
        op.create_table(
            "approval_decisions",
            sa.Column("approval_request_id", sa.Integer(), nullable=False),
            sa.Column("member_id", sa.Integer(), nullable=False),
            sa.Column("decision", sa.String(length=50), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["approval_request_id"], ["approval_requests.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["member_id"], ["workspace_members.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once("ix_approval_decisions_approval_request_id", "approval_decisions", ["approval_request_id"])
    _create_index_once("ix_approval_decisions_member_id", "approval_decisions", ["member_id"])


def downgrade() -> None:
    """移除本迁移补齐的 schema；仅供本地回退使用。"""

    for table_name in (
        "approval_decisions",
        "model_runs",
        "event_logs",
        "approval_requests",
        "workspace_comments",
        "evaluation_runs",
        "series_memory_evidence",
        "prompt_packs",
        "evaluation_cases",
        "artifacts",
        "series_memories",
        "provider_configs",
        "workspace_subscriptions",
        "workspace_members",
    ):
        if _table_exists(table_name):
            op.drop_table(table_name)

    if _column_exists("books", "workspace_id"):
        if _fk_exists("books", "fk_books_workspace_id_workspaces"):
            op.drop_constraint("fk_books_workspace_id_workspaces", "books", type_="foreignkey")
        if _index_exists("books", "ix_books_workspace_id"):
            op.drop_index("ix_books_workspace_id", table_name="books")
        op.drop_column("books", "workspace_id")

    for table_name in ("workspaces", "series"):
        if _table_exists(table_name):
            op.drop_table(table_name)
