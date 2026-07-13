"""Shared defaults, result type, and completion guards for BookRun generation."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.domains.artifacts.models import Artifact
from app.domains.book_runs.book_generation_progress import pause_by_failure
from app.domains.book_runs.errors import BookGenerationError
from app.domains.book_runs.models import BookRun

RECAP_FULL_CHAPTERS_DEFAULT = 2
RECAP_MAX_CHARS_DEFAULT = 6000
RECAP_OLDER_SUMMARY_MAX_CHARS = 160
DEFAULT_GENERATION_PREMISE = "沈砚在苍岭城调查失踪的铜钟匠，逐步追出城防钟楼背后的旧盟约。"
DEFAULT_GENERATION_TONE = "克制悬疑"
DEFAULT_GENERATION_POV = "沈砚"
DEFAULT_GENERATION_LOCATION = "苍岭城"
DEFAULT_GENERATION_TITLE_SEED = "铜钟疑案"


@dataclass(frozen=True)
class BookGenerationResult:
    """真实 LLM 整书生成产物，供验证报告引用。"""

    book_run: BookRun
    markdown_artifact: Artifact
    audit_artifact: Artifact
    chapter_count: int
    approved_chapter_count: int = 0


def count_approved_chapters(completed_chapters: list[dict[str, object]]) -> int:
    """统计真正批准（产出）的章数，与"已处理章数"区分，避免计数失真。"""

    return sum(1 for item in completed_chapters if item.get("approved"))


def assert_no_missing_chapters(
    session: Session,
    book_run_id: int,
    chapter_count: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
) -> None:
    """标记 completed 前确认 1..N 章全部批准产出。"""

    expected = set(range(1, chapter_count + 1))
    approved = {
        int(item["chapter_index"])
        for item in completed_chapters
        if item.get("approved") and item.get("chapter_index") is not None
    }
    missing = sorted(expected - approved)
    if not missing:
        return
    pause_by_failure(
        session,
        book_run_id,
        chapter_count,
        completed_chapters,
        tokens_used,
        f"缺章护栏：第 {missing} 章未批准或缺失，拒绝标记 completed。",
    )
    raise BookGenerationError(
        f"缺章护栏触发：第 {missing} 章未批准或缺失，BookRun 不标 completed（防止静默产出缺章成稿）。"
    )
