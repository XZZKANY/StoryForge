from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.book_runs.deterministic_smoke import (
    count_markdown_body_words,
    run_phase9a_deterministic_smoke,
)


def test_phase9a_deterministic_smoke_completes_book_run_and_exports(session: Session) -> None:
    """9A 冒烟应跑完三章 BookRun，并导出 book.md 与 audit_report.json。"""

    result = run_phase9a_deterministic_smoke(session)

    assert result.book_run.status == "completed"
    assert result.book_run.current_chapter_index == 3
    assert result.markdown_artifact.name == "book.md"
    assert result.audit_artifact.name == "audit_report.json"

    markdown = result.markdown_artifact.payload["content"]
    assert 3000 <= count_markdown_body_words(markdown) <= 6000
    assert "## 第 1 章" in markdown
    assert "## 第 3 章" in markdown

    report = result.audit_artifact.payload
    assert report["book_run_id"] == result.book_run.id
    assert len(report["chapters"]) == 3
    for chapter in report["chapters"]:
        assert chapter["model_run_id"] > 0
        assert chapter["judge_report_id"] > 0
        assert chapter["approved_scene_id"] > 0


def test_phase9a_deterministic_smoke_exports_ten_chapter_short_story(
    session: Session,
) -> None:
    """deterministic 环境应能产出 10 章和 3-5 万字短篇导出证据。"""

    result = run_phase9a_deterministic_smoke(
        session,
        chapter_count=10,
        target_word_count=50000,
        chapter_content_repetitions=90,
    )

    assert result.book_run.status == "completed"
    assert result.book_run.current_chapter_index == 10
    assert result.markdown_artifact.name == "book.md"
    assert result.audit_artifact.name == "audit_report.json"

    markdown = result.markdown_artifact.payload["content"]
    assert 30000 <= count_markdown_body_words(markdown) <= 50000
    assert "## 第 1 章" in markdown
    assert "## 第 10 章" in markdown

    report = result.audit_artifact.payload
    assert report["book_run_id"] == result.book_run.id
    assert len(report["chapters"]) == 10
    for chapter in report["chapters"]:
        assert chapter["model_run_id"] > 0
        assert chapter["judge_report_id"] > 0
        assert chapter["approved_scene_id"] > 0
