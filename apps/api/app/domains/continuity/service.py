from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import ConflictError, NotFoundError
from app.common.metrics import continuity_conflicts_total
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.edge_constraints import (
    ContinuityConflict,
    ContinuityEdgeCandidate,
    check_edge_constraints,
)
from app.domains.continuity.models import ContinuityEdge, ContinuityRecord
from app.domains.continuity.schemas import ChapterApprovalCreate


class ChapterNotFoundError(NotFoundError):
    """章节不存在时由服务层抛出，路由层转换为 HTTP 响应。"""


class ContinuityConflictError(ConflictError):
    """候选连续性边触发结构矛盾时抛出，整笔批准事务回滚。"""

    def __init__(self, conflicts: list[ContinuityConflict]) -> None:
        self.conflicts = conflicts
        summary = "；".join(f"[{c.severity}] {c.reason}" for c in conflicts)
        super().__init__(f"连续性结构冲突，批准被拒绝：{summary}")


@dataclass(frozen=True)
class ChapterApprovalResult:
    """批准回写结果，避免调用方读取 ORM 延迟关系。"""

    records: list[ContinuityRecord]
    edge_count: int


RECORD_DEFINITIONS = (
    ("previous_chapter_summary", "上一章摘要"),
    ("character_state_changes", "角色状态变化"),
    ("foreshadowing_changes", "伏笔变化"),
    ("style_drift", "风格漂移"),
    ("next_chapter_constraints", "下一章继承约束"),
)


def approve_chapter(session: Session, payload: ChapterApprovalCreate) -> ChapterApprovalResult:
    """将章节批准后的五类连续性事实与显式结构边写入真相源。

    候选边在落库前逐条做结构矛盾校验（成环 / 时间线倒错 / 状态时间窗冲突）；
    任一冲突即回滚整笔事务并抛 ContinuityConflictError（HTTP 409），不静默吞掉。
    """

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

    edge_count = _validate_and_stage_edges(session, chapter=chapter, payload=payload)

    session.commit()
    for record in records:
        session.refresh(record)
    return ChapterApprovalResult(records=records, edge_count=edge_count)


def _validate_and_stage_edges(
    session: Session,
    *,
    chapter: Chapter,
    payload: ChapterApprovalCreate,
) -> int:
    """逐条累积校验候选边：通过则 flush 进 session 供后续边校验，冲突则回滚并抛 409。"""

    conflicts: list[ContinuityConflict] = []
    for edge_input in payload.continuity_edges:
        candidate = ContinuityEdgeCandidate(
            edge_kind=edge_input.edge_kind,
            subject_ref=edge_input.subject_ref,
            predicate=edge_input.predicate,
            object_ref=edge_input.object_ref,
            valid_from_chapter=edge_input.valid_from_chapter,
            valid_to_chapter=edge_input.valid_to_chapter,
        )
        candidate = _normalize_edge_candidate(candidate, chapter_ordinal=chapter.ordinal)
        edge_conflicts = check_edge_constraints(
            session,
            book_id=chapter.book_id,
            candidate=candidate,
        )
        if edge_conflicts:
            conflicts.extend(edge_conflicts)
            continue
        session.add(
            ContinuityEdge(
                book_id=chapter.book_id,
                edge_kind=edge_input.edge_kind,
                subject_ref=edge_input.subject_ref,
                predicate=edge_input.predicate,
                object_ref=edge_input.object_ref,
                valid_from_chapter=candidate.valid_from_chapter,
                valid_to_chapter=candidate.valid_to_chapter,
                payload=edge_input.payload,
                version=1,
            )
        )
        # flush 使已通过的边对后续候选边的递归可达性查询可见（捕获同批自相矛盾）。
        session.flush()

    if conflicts:
        continuity_conflicts_total.inc(len(conflicts))
        session.rollback()
        raise ContinuityConflictError(conflicts)

    return len(payload.continuity_edges)


def _normalize_edge_candidate(
    candidate: ContinuityEdgeCandidate,
    *,
    chapter_ordinal: int,
) -> ContinuityEdgeCandidate:
    """让默认边生效窗口与当前批准章节对齐，避免校验和落库漂移。"""

    if candidate.valid_from_chapter <= 1:
        return candidate.model_copy(update={"valid_from_chapter": chapter_ordinal})
    return candidate


def _payload_value(payload: ChapterApprovalCreate, record_type: str) -> Any:
    """按记录类型读取请求值，避免路由层了解数据库载荷结构。"""

    return getattr(payload, record_type)
