from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ContinuityRecord
from app.domains.continuity.schemas import ChapterApprovalCreate


class ChapterNotFoundError(ValueError):
    """章节不存在时由服务层抛出，路由层转换为 HTTP 响应。"""


RECORD_DEFINITIONS = (
    ("previous_chapter_summary", "上一章摘要"),
    ("character_state_changes", "角色状态变化"),
    ("foreshadowing_changes", "伏笔变化"),
    ("style_drift", "风格漂移"),
    ("next_chapter_constraints", "下一章继承约束"),
)


def approve_chapter(session: Session, payload: ChapterApprovalCreate) -> Sequence[ContinuityRecord]:
    """将章节批准后的五类连续性事实写入真相源。"""

    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None:
        raise ChapterNotFoundError("章节不存在，无法记录连续性。")

    scene_id = session.scalar(
        select(Scene.id).where(Scene.chapter_id == chapter.id).order_by(Scene.ordinal, Scene.id).limit(1)
    )
    records = [
        ContinuityRecord(
            book_id=chapter.book_id,
            scene_id=scene_id,
            record_type=record_type,
            subject=subject,
            status="active",
            payload={"value": _payload_value(payload, record_type), "chapter_id": chapter.id},
            version=1,
        )
        for record_type, subject in RECORD_DEFINITIONS
    ]
    session.add_all(records)
    session.commit()
    for record in records:
        session.refresh(record)
    return records


def _payload_value(payload: ChapterApprovalCreate, record_type: str) -> Any:
    """按记录类型读取请求值，避免路由层了解数据库载荷结构。"""

    return getattr(payload, record_type)
