from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import NotFoundError
from app.common.redaction import redact_sensitive
from app.domains.events.models import EventLog
from app.domains.events.schemas import EventRecordCreate
from app.domains.workspaces.models import Workspace


class EventWorkspaceNotFoundError(NotFoundError):
    """事件归属的工作区不存在时抛出。"""


def record_event(session: Session, payload: EventRecordCreate) -> EventLog:
    if session.get(Workspace, payload.workspace_id) is None:
        raise EventWorkspaceNotFoundError("工作区不存在，无法写入事件。")
    event_data = payload.model_dump()
    event_data["payload"] = redact_sensitive(event_data.get("payload", {}))
    event = EventLog(**event_data)
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def list_workspace_events(session: Session, workspace_id: int) -> Sequence[EventLog]:
    if session.get(Workspace, workspace_id) is None:
        raise EventWorkspaceNotFoundError("工作区不存在。")
    return session.scalars(
        select(EventLog)
        .where(EventLog.workspace_id == workspace_id)
        .order_by(EventLog.id.desc())
    ).all()
