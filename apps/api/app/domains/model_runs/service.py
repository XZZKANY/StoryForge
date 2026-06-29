from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.model_runs.models import ModelRun
from app.domains.model_runs.recording import (  # noqa: F401  facade re-export
    ModelRunError,
    _optional_nonnegative_float,
    _optional_nonnegative_int,
    _optional_text,
    _payload_metadata,
    _require_nonnegative_int,
    _require_positive_int,
    _require_text,
    _validate_references,
    create_model_run,
    record_failed_runtime_model_run,
    record_runtime_model_run,
)
from app.domains.model_runs.recording import record_workflow_model_run_payload as _record_workflow_model_run_payload
from app.domains.model_runs.runs_diagnostics import (  # noqa: F401  facade re-export
    _checkpoint_from_progress,
    _failure_kind_from_error,
    _first_text,
    _lifecycle_status_from_job,
    _model_usage_summary,
    _provider_summary,
    _recoverable_from_progress,
    _retry_unavailable_reason,
    _runtime_diagnostics,
    _runtime_tool_summaries,
    _session_id,
    _string_list,
    _text_or_default,
    retry_runs_job_run,
)
from app.domains.model_runs.runs_diagnostics import get_runs_job_run as _get_runs_job_run


def list_model_runs(
    session: Session,
    *,
    workspace_id: int | None = None,
    book_id: int | None = None,
    job_run_id: int | None = None,
) -> Sequence[ModelRun]:
    statement = build_model_run_list_query(
        workspace_id=workspace_id, book_id=book_id, job_run_id=job_run_id
    )
    return session.scalars(statement).all()


def build_model_run_list_query(
    *,
    workspace_id: int | None = None,
    book_id: int | None = None,
    job_run_id: int | None = None,
):
    """构造按主键升序排列的模型运行日志查询，供分页 helper 复用。"""

    statement = select(ModelRun).order_by(ModelRun.id)
    if workspace_id is not None:
        statement = statement.where(ModelRun.workspace_id == workspace_id)
    if book_id is not None:
        statement = statement.where(ModelRun.book_id == book_id)
    if job_run_id is not None:
        statement = statement.where(ModelRun.job_run_id == job_run_id)
    return statement


def get_runs_job_run(session: Session, *, job_run_id: int) -> dict[str, Any]:
    """读取 Runs 工作台 JobRun 详情，并附带 runtime_diagnostics 摘要。"""

    return _get_runs_job_run(
        session,
        job_run_id=job_run_id,
        list_model_runs_for_job=lambda active_session: list_model_runs(active_session, job_run_id=job_run_id),
    )


def record_workflow_model_run_payload(session: Session, payload: Mapping[str, object]) -> ModelRun:
    """记录 workflow adapter 产出的 ModelRun payload，保留旧 source-pruning seam。"""

    return _record_workflow_model_run_payload(session, payload)
