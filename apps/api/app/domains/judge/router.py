from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.judge.schemas import JudgeIssueCreate, JudgeIssueRead
from app.domains.judge.service import JudgeInputError, create_judge_issues

router = APIRouter(prefix="/api/judge", tags=["结构化评审"])


@router.post("/issues", response_model=list[JudgeIssueRead], status_code=status.HTTP_201_CREATED)
def create_judge_issues_endpoint(payload: JudgeIssueCreate, session: SessionDependency) -> list[JudgeIssueRead]:
    """对章节片段执行本地确定性评审，返回结构化问题单。"""

    try:
        issues = create_judge_issues(session, payload)
    except JudgeInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [JudgeIssueRead.from_issue(issue) for issue in issues]
