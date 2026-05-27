from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress
from app.domains.books.models import Book


def seed_locked_blueprint(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """创建 BookRun API 所需的 locked Blueprint。"""

    with session_factory() as session:
        book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="林岚在雾港追查失真的灯塔信号。",
            tone="克制悬疑",
            target_word_count=4500,
            target_chapter_count=3,
            chapter_word_count_min=1000,
            chapter_word_count_max=1800,
            status="locked",
            version=2,
            metadata_={},
        )
        session.add(blueprint)
        session.commit()
        return {"book_id": book.id, "blueprint_id": blueprint.id}


def test_create_and_read_book_run(client: TestClient, session_factory: sessionmaker[Session]) -> None:
    """BookRun API 应能启动并读取三章短篇运行记录。"""

    scope = seed_locked_blueprint(session_factory)

    created_response = client.post("/api/book-runs", json=scope)

    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert created["book_id"] == scope["book_id"]
    assert created["blueprint_id"] == scope["blueprint_id"]
    assert created["status"] == "running"
    assert created["current_chapter_index"] == 1
    assert created["total_chapters"] == 3
    assert created["progress"] == {"completed_chapters": []}
    assert created["checkpoint"] == []
    assert created["tokens_used"] == 0
    assert created["cost_summary"] == {"estimated_cost": 0.0}

    read_response = client.get(f"/api/book-runs/{created['id']}")
    assert read_response.status_code == 200, read_response.text
    assert read_response.json()["id"] == created["id"]


def test_create_book_run_accepts_budget_limits(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 启动时应保存 token、时间和章节预算硬上限。"""

    scope = seed_locked_blueprint(session_factory)

    response = client.post(
        "/api/book-runs",
        json={**scope, "token_budget": 1200, "time_budget_sec": 300, "chapter_budget": 2},
    )

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["token_budget"] == 1200
    assert created["time_budget_sec"] == 300
    assert created["chapter_budget"] == 2
    assert created["tokens_used"] == 0


def test_create_book_run_requires_locked_blueprint(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """未锁定 Blueprint 不能启动 BookRun。"""

    with session_factory() as session:
        book = Book(title="未锁定作品", status="draft", premise="仍在规划。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="未锁定蓝图。",
            tone="克制",
            target_word_count=3000,
            target_chapter_count=3,
            chapter_word_count_min=800,
            chapter_word_count_max=1200,
            status="draft",
            version=1,
            metadata_={},
        )
        session.add(blueprint)
        session.commit()
        book_id = book.id
        blueprint_id = blueprint.id

    response = client.post("/api/book-runs", json={"book_id": book_id, "blueprint_id": blueprint_id})

    assert response.status_code == 422, response.text
    assert response.json() == {"detail": "Blueprint 尚未锁定，不能启动 BookRun。"}


def test_apply_book_run_progress_marks_completed(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookLoop 完成结果应持久化到 BookRun 状态和进度。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
            {"chapter_index": 3, "model_run_id": 31, "judge_report_id": 32, "approved_scene_id": 33},
        ]
    }

    with session_factory() as session:
        updated = apply_book_run_progress(
            session,
            created["id"],
            BookRunProgressUpdate(status="completed", current_chapter_index=3, progress=progress),
        )

    assert updated.status == "completed"
    assert updated.current_chapter_index == 3
    assert updated.progress == progress

    read_response = client.get(f"/api/book-runs/{created['id']}")
    assert read_response.status_code == 200, read_response.text
    assert read_response.json()["status"] == "completed"


def test_apply_book_run_progress_keeps_awaiting_review_chapter(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节暂停时 BookRun 应停在阻塞章节，后续章节不被标记完成。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    progress = {
        "completed_chapters": [{"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}],
        "blocked_chapter": {"chapter_index": 2, "judge_report_id": 20, "repair_patch_id": 21},
    }

    with session_factory() as session:
        updated = apply_book_run_progress(
            session,
            created["id"],
            BookRunProgressUpdate(status="awaiting_review", current_chapter_index=2, progress=progress),
        )

    assert updated.status == "awaiting_review"
    assert updated.current_chapter_index == 2
    assert updated.progress["blocked_chapter"]["chapter_index"] == 2


def test_progress_update_persists_checkpoint_and_budget_usage(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun progress 回填应生成只含引用 id 的 checkpoint，并保存预算用量。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 1000}).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
        ],
        "budget": {"tokens_used": 840, "estimated_cost": 0.42},
    }

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "paused_by_budget", "current_chapter_index": 2, "progress": progress},
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["status"] == "paused_by_budget"
    assert updated["tokens_used"] == 840
    assert updated["cost_summary"] == {"estimated_cost": 0.42, "token_budget": 1000, "tokens_remaining": 160}
    assert updated["checkpoint"] == [
        {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
        {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
    ]
    assert "final_draft" not in str(updated["checkpoint"])


def test_resume_book_run_continues_after_latest_checkpoint(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Resume 应从最近 checkpoint 的下一章继续，避免重复批准已完成章节。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
        ],
        "budget": {"tokens_used": 980, "estimated_cost": 0.51},
    }
    client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "paused_by_budget", "current_chapter_index": 2, "progress": progress},
    )

    response = client.post(f"/api/book-runs/{created['id']}/resume")

    assert response.status_code == 200, response.text
    resumed = response.json()
    assert resumed["status"] == "running"
    assert resumed["current_chapter_index"] == 3
    assert resumed["progress"]["resume_from_chapter_index"] == 3
    assert resumed["progress"]["completed_chapters"] == progress["completed_chapters"]


def test_patch_book_run_progress_endpoint(client: TestClient, session_factory: sessionmaker[Session]) -> None:
    """Workflow adapter 可通过 HTTP 回填 BookRun completed 状态。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 3,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
                    {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
                    {"chapter_index": 3, "model_run_id": 31, "judge_report_id": 32, "approved_scene_id": 33},
                ]
            },
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"
    assert response.json()["current_chapter_index"] == 3
