from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint


def test_book_run_resume_gate_uses_latest_checkpoint(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Phase 9B resume 门禁：从最新 checkpoint 下一章继续。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    completed = [
        {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
        {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
    ]
    client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "awaiting_review",
            "current_chapter_index": 2,
            "progress": {"completed_chapters": completed},
        },
    )

    response = client.post(f"/api/book-runs/{created['id']}/resume")

    assert response.status_code == 200, response.text
    resumed = response.json()
    assert resumed["status"] == "running"
    assert resumed["current_chapter_index"] == 3
    assert resumed["progress"]["resume_from_chapter_index"] == 3
    assert resumed["progress"]["completed_chapters"] == completed
