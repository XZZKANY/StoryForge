from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.batch_refinery.schemas import BatchRefineryItemCreate, BatchRefineryRunCreate
from app.domains.books.models import Book, Scene
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import JudgeInputError, create_judge_issues
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import RepairInputError, create_repair_patch


class BatchRefineryInputError(ValueError):
    """批量精修请求缺少作品或任务记录时抛出。"""


def run_batch_refinery(session: Session, payload: BatchRefineryRunCreate) -> JobRun:
    """同步执行一批确定性评审与修复，并把逐项结果写入 JobRun。"""

    if session.get(Book, payload.book_id) is None:
        raise BatchRefineryInputError("作品不存在，无法执行批量精修。")
    job = JobRun(book_id=payload.book_id, job_type="batch_refinery", status="running", progress={})
    session.add(job)
    session.flush()

    items: list[dict] = []
    succeeded = 0
    failed = 0
    for index, item in enumerate(payload.items):
        try:
            result = _run_batch_item(session, job, index, item)
            succeeded += 1
        except (JudgeInputError, RepairInputError, BatchRefineryInputError) as exc:
            result = {
                "index": index,
                "scene_id": item.scene_id,
                "status": "failed",
                "issue_ids": [],
                "repair_patch_id": None,
                "repair_patch_ids": [],
                "error": str(exc),
                "retry_input": item.model_dump(),
            }
            failed += 1
        items.append(result)

    job.status = "completed" if failed == 0 else "partial_failed"
    job.progress = {
        "total": len(payload.items),
        "succeeded": succeeded,
        "failed": failed,
        "items": items,
        "retry_items": [item["retry_input"] for item in items if item["status"] == "failed"],
    }
    job.error_message = None if failed == 0 else "部分场景精修失败，可根据 items 明细重试。"
    session.commit()
    session.refresh(job)
    return job


def get_batch_refinery_run(session: Session, job_id: int) -> JobRun:
    """读取批量精修运行记录。"""

    job = session.get(JobRun, job_id)
    if job is None or job.job_type != "batch_refinery":
        raise BatchRefineryInputError("批量精修任务不存在。")
    return job


def _run_batch_item(
    session: Session,
    job: JobRun,
    index: int,
    item: BatchRefineryItemCreate,
) -> dict:
    """执行单个场景的评审与修复，返回可写入 JobRun 的稳定明细。"""

    _validate_scene_belongs_to_book(session, job.book_id, item.scene_id)
    issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=item.scene_id,
            scene_packet_id=item.scene_packet_id,
            content=item.content,
            required_facts=item.required_facts,
            style_rules=item.style_rules,
            evidence_links=item.evidence_links,
        ),
    )
    patch_ids = _create_repair_patches(session, job, issues, item.content)
    return {
        "index": index,
        "scene_id": item.scene_id,
        "status": "succeeded",
        "issue_ids": [issue.id for issue in issues],
        "repair_patch_id": patch_ids[0] if patch_ids else None,
        "repair_patch_ids": patch_ids,
        "error": None,
        "retry_input": None,
    }


def _validate_scene_belongs_to_book(session: Session, book_id: int | None, scene_id: int) -> None:
    """确认批量项场景存在且归属本次作品，避免跨作品混入任务明细。"""

    scene = session.get(Scene, scene_id)
    if scene is None:
        raise BatchRefineryInputError("场景不存在，无法执行批量精修。")
    if scene.chapter is None or scene.chapter.book_id != book_id:
        raise BatchRefineryInputError("场景不属于指定作品，无法执行批量精修。")


def _create_repair_patches(session: Session, job: JobRun, issues: list[JudgeIssue], content: str) -> list[int]:
    """为本项问题单生成定向补丁，并把问题单与补丁都绑定到同一 JobRun。"""

    patch_ids: list[int] = []
    for issue in issues:
        issue.job_run_id = job.id
        patch = create_repair_patch(session, RepairPatchCreate(issue_id=issue.id, content=content))
        patch.job_run_id = job.id
        patch_ids.append(patch.id)
    return patch_ids
