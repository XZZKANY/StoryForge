from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.exceptions import NotFoundError
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.studio.schemas import StudioBookListItem, StudioChapterGoalRead, StudioScenePacketRead


def list_studio_books(session: Session, workspace_id: int | None = None) -> list[StudioBookListItem]:
    """读取 Studio 首个真实数据源所需的作品列表摘要。"""

    latest_chapters = (
        select(Chapter.book_id, func.max(Chapter.ordinal).label("recent_chapter_ordinal"))
        .group_by(Chapter.book_id)
        .subquery()
    )
    statement = (
        select(Book.id, Book.title, latest_chapters.c.recent_chapter_ordinal)
        .outerjoin(latest_chapters, Book.id == latest_chapters.c.book_id)
        .order_by(Book.id)
    )
    if workspace_id is not None:
        statement = statement.where(Book.workspace_id == workspace_id)

    rows = session.execute(statement).all()
    return [
        StudioBookListItem(
            id=row.id,
            title=row.title,
            recent_chapter_ordinal=row.recent_chapter_ordinal,
        )
        for row in rows
    ]


class StudioChapterGoalNotFoundError(NotFoundError):
    """章节目标不存在时由路由层转换为可重试的 HTTP 响应。"""


class StudioScenePacketNotFoundError(NotFoundError):
    """Scene Packet 不存在时由路由层转换为可重试的 HTTP 响应。"""


def read_studio_chapter_goal(session: Session, *, book_id: int, target_ordinal: int) -> StudioChapterGoalRead:
    """读取 Studio 章节目标数据源，不触发生成或跨页面执行流。"""

    target_chapter = session.scalar(
        select(Chapter)
        .where(Chapter.book_id == book_id, Chapter.ordinal == target_ordinal)
        .order_by(Chapter.id)
        .limit(1)
    )
    if target_chapter is None:
        raise StudioChapterGoalNotFoundError("章节目标不存在，无法读取 Studio 章节目标。")

    previous_chapter = session.scalar(
        select(Chapter)
        .where(Chapter.book_id == book_id, Chapter.ordinal < target_ordinal)
        .order_by(Chapter.ordinal.desc(), Chapter.id.desc())
        .limit(1)
    )
    constraints = _next_chapter_constraints(session, book_id=book_id, previous_chapter_id=previous_chapter.id if previous_chapter else None)

    return StudioChapterGoalRead(
        book_id=book_id,
        target_chapter_id=target_chapter.id,
        target_chapter_ordinal=target_chapter.ordinal,
        target_chapter_title=target_chapter.title,
        chapter_goal=target_chapter.summary or target_chapter.title,
        previous_chapter_summary=previous_chapter.summary if previous_chapter else None,
        continuity_constraints=constraints,
    )


def _next_chapter_constraints(session: Session, *, book_id: int, previous_chapter_id: int | None) -> list[str]:
    """从上一章批准回写事实中读取下一章继承约束。"""

    if previous_chapter_id is None:
        return []
    rows = session.scalars(
        select(ContinuityRecord)
        .where(
            ContinuityRecord.book_id == book_id,
            ContinuityRecord.record_type == "next_chapter_constraints",
            ContinuityRecord.status == "active",
        )
        .order_by(ContinuityRecord.id)
    ).all()
    constraints: list[str] = []
    for record in rows:
        if record.payload.get("chapter_id") != previous_chapter_id:
            continue
        value = record.payload.get("value")
        if isinstance(value, list):
            constraints.extend(str(item) for item in value)
        elif value is not None:
            constraints.append(str(value))
    return constraints


def read_studio_scene_packet(session: Session, *, book_id: int, target_ordinal: int) -> StudioScenePacketRead:
    """读取 Studio Scene Packet 摘要，不重新触发上下文包组装。"""

    row = session.execute(
        select(ScenePacket, Scene, Chapter)
        .join(Scene, ScenePacket.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(Chapter.book_id == book_id, Chapter.ordinal == target_ordinal)
        .order_by(ScenePacket.id.desc())
        .limit(1)
    ).first()
    if row is None:
        raise StudioScenePacketNotFoundError("Scene Packet 不存在，无法读取 Studio Scene Packet。")

    scene_packet, scene, chapter = row
    packet = scene_packet.packet or {}
    evidence_links = packet.get("证据链接")
    budget_summary = packet.get("上下文预算")
    return StudioScenePacketRead(
        book_id=book_id,
        target_chapter_ordinal=chapter.ordinal,
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        job_run_id=scene_packet.job_run_id,
        status=scene_packet.status,
        chapter_goal=packet.get("章节目标") if isinstance(packet.get("章节目标"), str) else None,
        evidence_count=len(evidence_links) if isinstance(evidence_links, list) else 0,
        compiled_context_id=packet.get("compiled_context_id") if isinstance(packet.get("compiled_context_id"), str) else None,
        budget_summary=budget_summary if isinstance(budget_summary, dict) else {},
    )
