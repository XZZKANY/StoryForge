from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.blueprints.service import trigger_chapter_plan
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.service import build_book_run_workflow_dispatch
from app.domains.books.models import Book


def seed_dispatchable_book_run(session_factory: sessionmaker[Session]) -> int:
    """创建已生成章节计划的 running BookRun，供 workflow dispatch 使用。"""

    with session_factory() as session:
        book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="林岚在雾港追查失真的灯塔信号。",
            tone="克制悬疑",
            target_word_count=4500,
            target_chapter_count=2,
            chapter_word_count_min=1000,
            chapter_word_count_max=1800,
            status="locked",
            version=2,
            metadata_={},
        )
        session.add(blueprint)
        session.commit()
        trigger_chapter_plan(session, blueprint.id)
        book_run = BookRun(
            book_id=book.id,
            blueprint_id=blueprint.id,
            status="running",
            current_chapter_index=1,
            total_chapters=2,
            progress={"completed_chapters": []},
            checkpoint=[],
            token_budget=1000,
            tokens_used=0,
            time_budget_sec=300,
            elapsed_time_sec=0,
            chapter_budget=2,
            estimated_cost=0.0,
            cost_summary={"estimated_cost": 0.0},
        )
        session.add(book_run)
        session.commit()
        return book_run.id


def test_build_book_run_workflow_dispatch_payload(session_factory: sessionmaker[Session]) -> None:
    """API 应生成 workflow worker 可消费的 BookRun dispatch payload。"""

    book_run_id = seed_dispatchable_book_run(session_factory)

    with session_factory() as session:
        dispatch = build_book_run_workflow_dispatch(session, book_run_id)

    assert dispatch.book_run_id == book_run_id
    assert dispatch.start_chapter_index == 1
    assert dispatch.total_chapters == 2
    assert dispatch.existing_checkpoint == []
    assert dispatch.token_budget == 1000
    assert dispatch.time_budget_sec == 300
    assert dispatch.chapter_budget == 2
    assert [chapter.chapter_index for chapter in dispatch.chapters] == [1, 2]
    assert all(chapter.chapter_id > 0 for chapter in dispatch.chapters)
    assert dispatch.chapters[0].chapter_goal


def test_workflow_dispatch_endpoint_returns_payload(client: TestClient, session_factory: sessionmaker[Session]) -> None:
    """内部调度接口只返回 dispatch payload，不执行 workflow。"""

    book_run_id = seed_dispatchable_book_run(session_factory)

    response = client.get(f"/api/book-runs/{book_run_id}/workflow-dispatch")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["book_run_id"] == book_run_id
    assert payload["chapters"][0]["chapter_index"] == 1
    assert payload["chapters"][0]["chapter_goal"]


def test_workflow_dispatch_requires_chapter_plan(session_factory: sessionmaker[Session]) -> None:
    """缺少章节计划时拒绝生成 dispatch，避免 workflow 收到未知 chapter_id。"""

    with session_factory() as session:
        book = Book(title="未规划作品", status="draft", premise="缺少章节计划。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="缺少章节计划。",
            tone="克制",
            target_word_count=3000,
            target_chapter_count=1,
            chapter_word_count_min=800,
            chapter_word_count_max=1200,
            status="locked",
            version=1,
            metadata_={},
        )
        session.add(blueprint)
        session.flush()
        book_run = BookRun(
            book_id=book.id,
            blueprint_id=blueprint.id,
            status="running",
            current_chapter_index=1,
            total_chapters=1,
            progress={"completed_chapters": []},
            checkpoint=[],
            cost_summary={"estimated_cost": 0.0},
        )
        session.add(book_run)
        session.commit()
        book_run_id = book_run.id

        try:
            build_book_run_workflow_dispatch(session, book_run_id)
        except Exception as exc:
            assert "章节计划" in str(exc)
        else:
            raise AssertionError("缺少章节计划时必须拒绝生成 dispatch。")
