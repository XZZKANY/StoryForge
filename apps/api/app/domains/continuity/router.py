from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.continuity.schemas import ChapterApprovalCreate, ChapterApprovalRead
from app.domains.continuity.service import ChapterNotFoundError, approve_chapter

router = APIRouter(prefix="/api/continuity", tags=["章节连续性"])


@router.post(
    "/chapter-approval",
    response_model=ChapterApprovalRead,
    status_code=status.HTTP_201_CREATED,
    summary="提交章节批准并刷新连续性",
)
def approve_chapter_endpoint(payload: ChapterApprovalCreate, session: SessionDependency) -> ChapterApprovalRead:
    """记录章节批准后的摘要、状态变化、伏笔变化和继承约束。"""

    try:
        result = approve_chapter(session, payload)
    except ChapterNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    records = list(result.records)
    return ChapterApprovalRead(
        chapter_id=payload.chapter_id,
        book_id=records[0].book_id,
        record_count=len(records),
        records=records,
        continuity_edge_count=result.edge_count,
    )
