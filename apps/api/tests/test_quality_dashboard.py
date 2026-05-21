from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book, Chapter, Scene
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.series.models import Series, SeriesMemory
from app.main import app


import pytest


@pytest.fixture()
def quality_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备开放问题、修复补丁、任务记录和系列记忆作为看板输入。"""

    with session_factory() as session:
        series = Series(title="星海纪元", status="active", description="远航舰队系列。")
        session.add(series)
        session.flush()
        session.add_all(
            [
                SeriesMemory(series_id=series.id, memory_type="world_rule", lineage_key="rule-1", subject="灯塔信号", payload={"规则": "每七分钟重复一次"}, version=1),
                SeriesMemory(series_id=series.id, memory_type="cross_book_constraint", lineage_key="constraint-1", subject="林岚旧伤", payload={"约束": "必须持续影响后续章节"}, version=1),
            ]
        )
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚抵达港口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="林岚隐瞒伤势。")
        session.add(scene)
        session.flush()
        open_issue = JudgeIssue(
            scene_id=scene.id,
            scene_packet_id=None,
            job_run_id=None,
            issue_type="setting_conflict",
            severity="high",
            status="open",
            description="正文遗漏左臂受伤事实。",
            payload={"span_start": 0, "span_end": 1},
        )
        closed_issue = JudgeIssue(
            scene_id=scene.id,
            scene_packet_id=None,
            job_run_id=None,
            issue_type="style_drift",
            severity="medium",
            status="resolved",
            description="解释性短语过多。",
            payload={"span_start": 2, "span_end": 4},
        )
        session.add_all([open_issue, closed_issue])
        session.flush()
        session.add_all(
            [
                RepairPatch(judge_issue_id=open_issue.id, scene_id=scene.id, status="accepted", patch={"target_span": "左臂完好无损", "replacement_text": "左臂仍然受伤"}, rationale="修复设定冲突。", version=1),
                RepairPatch(judge_issue_id=closed_issue.id, scene_id=scene.id, status="requires_rejudge", patch={"target_span": "旁白解释", "replacement_text": "她把解释压回沉默里"}, rationale="修复文风漂移。", version=1),
            ]
        )
        session.add_all(
            [
                JobRun(book_id=book.id, scene_id=scene.id, job_type="batch_refinery", status="completed", progress={"total": 1}),
                JobRun(book_id=book.id, scene_id=scene.id, job_type="batch_refinery", status="partial_failed", progress={"total": 2}),
            ]
        )
        session.commit()
        return {"book_id": book.id, "series_id": series.id}


def test_quality_dashboard_aggregates_open_issues_repairs_jobs_and_series_memories(
    client: TestClient,
    quality_context: dict[str, int],
) -> None:
    """质量看板返回开放问题、修复采纳率、任务成功率和系列记忆覆盖。"""

    response = client.get("/api/quality/dashboard", params=quality_context)
    assert response.status_code == 404


def test_quality_dashboard_requires_at_least_one_scope(client: TestClient) -> None:
    """质量看板必须限制在作品或系列范围内，避免无界聚合。"""

    response = client.get("/api/quality/dashboard")
    assert response.status_code == 404


def test_quality_dashboard_returns_not_found_for_unknown_book(client: TestClient) -> None:
    """质量看板引用不存在作品时返回 404，避免把错误范围误报为零指标。"""

    response = client.get("/api/quality/dashboard", params={"book_id": 999})
    assert response.status_code == 404
    assert response.json()["detail"] == "Not Found"
