from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.books.models import Chapter, Scene
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.quality.schemas import QualityDashboardQuery, QualityDashboardRead
from app.domains.series.models import Series, SeriesMemory


class QualityDashboardInputError(ValueError):
    """质量看板请求缺少必要过滤条件或引用不存在实体时抛出。"""


def build_quality_dashboard(session: Session, query: QualityDashboardQuery) -> QualityDashboardRead:
    """聚合指定作品或系列范围下的质量指标。"""

    if query.series_id is not None and session.get(Series, query.series_id) is None:
        raise QualityDashboardInputError("系列不存在，无法读取质量看板。")

    scene_ids = _scene_ids_for_book(session, query.book_id)
    open_issue_count = _count_open_issues(session, scene_ids)
    accepted_repairs, total_repairs = _count_repairs(session, scene_ids)
    successful_jobs, total_jobs = _count_jobs(session, query.book_id)
    series_memory_count = _count_series_memories(session, query.series_id)

    repair_acceptance_rate = _safe_ratio(accepted_repairs, total_repairs)
    job_success_rate = _safe_ratio(successful_jobs, total_jobs)
    return QualityDashboardRead(
        book_id=query.book_id,
        series_id=query.series_id,
        open_issue_count=open_issue_count,
        repair_acceptance_rate=repair_acceptance_rate,
        job_success_rate=job_success_rate,
        series_memory_count=series_memory_count,
        open_issue_summary=f"当前开放问题 {open_issue_count} 条。",
        repair_acceptance_summary=f"修复采纳率 {repair_acceptance_rate:.2f}。",
        job_success_summary=f"任务成功率 {job_success_rate:.2f}。",
        series_memory_summary=f"系列记忆覆盖 {series_memory_count} 条。",
    )


def _scene_ids_for_book(session: Session, book_id: int | None) -> list[int]:
    if book_id is None:
        return []
    return list(
        session.scalars(
            select(Scene.id).join(Chapter, Scene.chapter_id == Chapter.id).where(Chapter.book_id == book_id).order_by(Scene.id)
        ).all()
    )


def _count_open_issues(session: Session, scene_ids: list[int]) -> int:
    if not scene_ids:
        return 0
    return int(
        session.scalar(
            select(func.count(JudgeIssue.id)).where(JudgeIssue.scene_id.in_(scene_ids), JudgeIssue.status == "open")
        )
        or 0
    )


def _count_repairs(session: Session, scene_ids: list[int]) -> tuple[int, int]:
    if not scene_ids:
        return 0, 0
    rows = session.scalars(select(RepairPatch).where(RepairPatch.scene_id.in_(scene_ids)).order_by(RepairPatch.id)).all()
    accepted = sum(1 for row in rows if row.status == "accepted")
    return accepted, len(rows)


def _count_jobs(session: Session, book_id: int | None) -> tuple[int, int]:
    if book_id is None:
        return 0, 0
    rows = session.scalars(select(JobRun).where(JobRun.book_id == book_id).order_by(JobRun.id)).all()
    successful = sum(1 for row in rows if row.status == "completed")
    return successful, len(rows)


def _count_series_memories(session: Session, series_id: int | None) -> int:
    if series_id is None:
        return 0
    latest_versions = (
        select(SeriesMemory.lineage_key, func.max(SeriesMemory.version).label("latest_version"))
        .where(SeriesMemory.series_id == series_id, SeriesMemory.status == "active")
        .group_by(SeriesMemory.lineage_key)
        .subquery()
    )
    return int(
        session.scalar(
            select(func.count(SeriesMemory.id))
            .select_from(SeriesMemory)
            .join(
                latest_versions,
                (SeriesMemory.lineage_key == latest_versions.c.lineage_key)
                & (SeriesMemory.version == latest_versions.c.latest_version),
            )
            .where(SeriesMemory.series_id == series_id, SeriesMemory.status == "active")
        )
        or 0
    )


def _safe_ratio(success: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(success / total, 4)
