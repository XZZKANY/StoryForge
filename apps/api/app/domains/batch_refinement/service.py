from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.domains.books.models import Book, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.jobs.models import JobRun
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import create_judge_issues
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import create_repair_patch


class BatchRefinementInputError(InputError):
    """批量精修兼容接口无法定位作品、场景或任务时抛出。"""


def create_batch_refinement_job(
    session: Session,
    *,
    book_id: int,
    scene_ids: list[int],
    required_facts: list[str],
    style_rules: list[str],
) -> JobRun:
    """同步执行早期 Phase 2 批量精修流程，并把摘要写入 JobRun。"""

    if session.get(Book, book_id) is None:
        raise BatchRefinementInputError("作品不存在，无法执行批量精修。")

    job = JobRun(
        book_id=book_id,
        job_type="batch_refinement",
        status="running",
        progress={"total": len(scene_ids), "processed": 0, "issue_count": 0, "patch_count": 0},
    )
    session.add(job)
    session.flush()

    issue_ids: list[int] = []
    patch_ids: list[int] = []
    packet_ids: list[int] = []
    for scene_id in scene_ids:
        scene = _scene_for_book(session, book_id, scene_id)
        packet = _latest_scene_packet(session, scene.id)
        if packet is not None:
            packet.job_run_id = job.id
            packet_ids.append(packet.id)
        issues = create_judge_issues(
            session,
            JudgeIssueCreate(
                scene_id=scene.id,
                scene_packet_id=packet.id if packet else None,
                content=scene.content or "",
                required_facts=required_facts,
                style_rules=style_rules,
            ),
        )
        for issue in issues:
            issue.job_run_id = job.id
            issue.status = "requires_rejudge"
            issue_ids.append(issue.id)
            patch = create_repair_patch(session, RepairPatchCreate(issue_id=issue.id, content=scene.content or ""))
            patch.job_run_id = job.id
            patch_ids.append(patch.id)

    job.status = "completed"
    job.progress = {
        "total": len(scene_ids),
        "processed": len(scene_ids),
        "issue_count": len(issue_ids),
        "patch_count": len(patch_ids),
        "issue_ids": issue_ids,
        "patch_ids": patch_ids,
        "scene_packet_ids": packet_ids,
    }
    session.commit()
    session.refresh(job)
    return job


def get_batch_refinement_job(session: Session, job_run_id: int) -> JobRun:
    """读取早期批量精修任务。"""

    job = session.get(JobRun, job_run_id)
    if job is None or job.job_type != "batch_refinement":
        raise BatchRefinementInputError("批量精修任务不存在。")
    return job


def batch_refinement_payload(job: JobRun) -> dict[str, object]:
    """把 JobRun 转成兼容响应结构。"""

    progress = job.progress or {}
    return {
        "job_run_id": job.id,
        "status": job.status,
        "progress": progress,
        "issue_ids": _int_list(progress.get("issue_ids")),
        "patch_ids": _int_list(progress.get("patch_ids")),
    }


def _scene_for_book(session: Session, book_id: int, scene_id: int) -> Scene:
    scene = session.get(Scene, scene_id)
    if scene is None or scene.chapter is None or scene.chapter.book_id != book_id:
        raise BatchRefinementInputError("场景不存在或不属于指定作品。")
    return scene


def _latest_scene_packet(session: Session, scene_id: int) -> ScenePacket | None:
    return session.scalars(
        select(ScenePacket).where(ScenePacket.scene_id == scene_id).order_by(ScenePacket.id.desc())
    ).first()


def _int_list(value: object) -> list[int]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, int)]
