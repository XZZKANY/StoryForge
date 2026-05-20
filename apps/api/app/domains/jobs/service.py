from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session
from app.common.exceptions import InputError

from app.domains.jobs.models import JobRun


class JobRuntimeBridgeError(InputError):
    """任务与运行时桥接失败。"""


def sync_job_run_with_runtime(
    session: Session,
    *,
    job_run_id: int,
    thread_id: str,
    current_node: str,
    status: str,
    approval_status: str,
    provider_execution: dict[str, Any] | None = None,
) -> JobRun:
    job = session.get(JobRun, job_run_id)
    if job is None:
        raise JobRuntimeBridgeError("任务不存在，无法同步运行时状态。")
    progress = dict(job.progress or {})
    progress.update(
        {
            "thread_id": thread_id,
            "current_node": current_node,
            "approval_status": approval_status,
        }
    )
    if provider_execution is not None:
        progress["provider_execution"] = provider_execution
    job.progress = progress
    job.status = status
    session.commit()
    session.refresh(job)
    return job
