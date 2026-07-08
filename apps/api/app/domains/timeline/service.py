from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.common.redaction import redact_sensitive
from app.domains.books.models import Book, Chapter
from app.domains.timeline.models import TimelineEventRecord
from app.domains.timeline.schemas import TimelineEventCreate


class TimelineEventError(InputError):
    """时间线事件输入引用不存在或作用域不一致。"""


def create_timeline_event(session: Session, payload: TimelineEventCreate) -> TimelineEventRecord:
    """创建时间线事件，并校验作品与章节归属。"""

    _validate_timeline_scope(session, payload.book_id, payload.chapter_id, payload.project_id)
    event_data = payload.model_dump()
    event_data["payload"] = redact_sensitive(event_data.get("payload", {}))
    event = TimelineEventRecord(**event_data)
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def list_timeline_events(
    session: Session,
    *,
    project_id: int | None = None,
    book_id: int | None = None,
    volume_id: int | None = None,
    chapter_id: int | None = None,
) -> Sequence[TimelineEventRecord]:
    """按可选作用域读取时间线事件，返回稳定时间顺序。"""

    return session.scalars(
        build_timeline_event_list_query(
            project_id=project_id,
            book_id=book_id,
            volume_id=volume_id,
            chapter_id=chapter_id,
        )
    ).all()


def build_timeline_event_list_query(
    *,
    project_id: int | None = None,
    book_id: int | None = None,
    volume_id: int | None = None,
    chapter_id: int | None = None,
):
    """构造时间线事件列表查询，供 API 和后续分页能力复用。"""

    statement = select(TimelineEventRecord).order_by(TimelineEventRecord.time_order, TimelineEventRecord.id)
    if project_id is not None:
        statement = statement.where(TimelineEventRecord.project_id == project_id)
    if book_id is not None:
        statement = statement.where(TimelineEventRecord.book_id == book_id)
    if volume_id is not None:
        statement = statement.where(TimelineEventRecord.volume_id == volume_id)
    if chapter_id is not None:
        statement = statement.where(TimelineEventRecord.chapter_id == chapter_id)
    return statement


def _validate_timeline_scope(session: Session, book_id: int, chapter_id: int, project_id: int) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise TimelineEventError("作品不存在，无法创建时间线事件。")
    if book.workspace_id is not None and project_id != book.workspace_id:
        raise TimelineEventError("项目与作品工作区不匹配，无法创建时间线事件。")
    chapter_book_id = session.scalar(select(Chapter.book_id).where(Chapter.id == chapter_id))
    if chapter_book_id != book_id:
        raise TimelineEventError("章节不存在或不属于当前作品，无法创建时间线事件。")
