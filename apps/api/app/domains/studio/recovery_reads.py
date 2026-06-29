from __future__ import annotations

from sqlalchemy.orm import Session

from app.common.exceptions import NotFoundError
from app.domains.jobs.models import JobRun
from app.domains.studio.schemas import StudioRecoverySummaryRead


class StudioRecoverySummaryNotFoundError(NotFoundError):
    """恢复摘要目标不存在时由路由层转换为可重试的 HTTP 响应。"""


def read_studio_recovery_summary(session: Session, *, job_run_id: int) -> StudioRecoverySummaryRead:
    """读取失败恢复资格摘要，不触发重试或运行时续跑。"""

    job = session.get(JobRun, job_run_id)
    if job is None:
        raise StudioRecoverySummaryNotFoundError("任务不存在，无法读取失败恢复摘要。")

    progress = dict(job.progress or {})
    checkpoint = {
        key: progress[key]
        for key in ("thread_id", "current_node", "approval_status")
        if key in progress
    }
    failed_node = _first_string(progress, "failed_node", "current_node")
    recoverable_steps = _recoverable_steps(progress, failed_node=failed_node)
    error_summary = job.error_message or _first_string(progress, "error_summary", "error_message")

    unrecoverable_reason = None
    if job.status != "failed":
        unrecoverable_reason = "任务尚未失败，无需执行失败恢复。"
    elif not checkpoint:
        unrecoverable_reason = "缺少 checkpoint，无法定位恢复入口。"
    elif not recoverable_steps:
        unrecoverable_reason = "缺少可恢复步骤，无法生成恢复摘要。"
    elif not error_summary:
        unrecoverable_reason = "缺少错误摘要，无法判断恢复风险。"

    return StudioRecoverySummaryRead(
        can_recover=unrecoverable_reason is None,
        failed_node=failed_node,
        checkpoint=checkpoint or None,
        recoverable_steps=recoverable_steps,
        error_summary=error_summary,
        unrecoverable_reason=unrecoverable_reason,
    )


def _first_string(payload: dict, *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _recoverable_steps(progress: dict, *, failed_node: str | None) -> list[str]:
    steps = progress.get("recoverable_steps")
    if isinstance(steps, list):
        return [str(step) for step in steps if str(step)]
    if failed_node:
        return [f"从 {failed_node} 重新读取 checkpoint 后继续执行"]
    return []
