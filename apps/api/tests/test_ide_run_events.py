from __future__ import annotations

import json

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint

from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress
from app.domains.ide.service import build_run_events, encode_sse_event


def test_build_run_events_projects_progress_checkpoint_blocked_and_budget(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """IDE Run Panel 事件应从 BookRun 真相源投影进度、checkpoint、阻塞章节和预算。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 1000}).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
        ],
        "blocked_chapter": {"chapter_index": 3, "judge_report_id": 31, "repair_patch_id": 32},
        "budget": {"tokens_used": 840, "elapsed_time_sec": 61, "estimated_cost": 0.42},
        "provider_fallback": {"from": "primary", "to": "backup", "reason": "rate_limit"},
    }
    with session_factory() as session:
        book_run = apply_book_run_progress(
            session,
            created["id"],
            BookRunProgressUpdate(status="awaiting_review", current_chapter_index=3, progress=progress),
        )
        events = build_run_events(book_run)

    assert [event.event for event in events] == ["progress", "checkpoint", "blocked", "budget", "provider_fallback"]
    progress_event = events[0].data
    assert progress_event["book_run_id"] == created["id"]
    assert progress_event["status"] == "awaiting_review"
    assert progress_event["current_chapter_index"] == 3
    assert progress_event["total_chapters"] == 3
    assert progress_event["completed_count"] == 2
    assert events[1].data["latest_checkpoint"]["chapter_index"] == 2
    assert events[2].data["blocked_chapter"]["chapter_index"] == 3
    assert events[3].data["tokens_used"] == 840
    assert events[3].data["tokens_remaining"] == 160
    assert events[4].data["provider_fallback"]["to"] == "backup"


def test_encode_sse_event_uses_named_event_and_json_payload() -> None:
    """SSE 文本必须保留 event 名和 JSON data，方便前端 EventSource 消费。"""

    text = encode_sse_event("progress", {"book_run_id": 7, "status": "running"})

    assert text.startswith("event: progress\n")
    assert text.endswith("\n\n")
    payload = json.loads(text.split("data: ", 1)[1])
    assert payload == {"book_run_id": 7, "status": "running"}


def test_read_run_events_endpoint_returns_sse_snapshot(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """IDE runs events 端点应返回 text/event-stream 快照事件。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 500}).json()
    client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 3,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
                    {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
                    {"chapter_index": 3, "model_run_id": 31, "judge_report_id": 32, "approved_scene_id": 33},
                ],
                "budget": {"tokens_used": 420, "estimated_cost": 0.25},
            },
        },
    )

    response = client.get(f"/api/ide/runs/{created['id']}/events")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert "event: progress" in body
    assert "event: checkpoint" in body
    assert "event: budget" in body
    assert "event: completed" in body
    assert '"book_run_id":' in body
    assert '"tokens_remaining": 80' in body


def test_read_run_events_endpoint_returns_404_for_missing_book_run(client: TestClient) -> None:
    """不存在的 BookRun 应返回 404，而不是打开空 SSE。"""

    response = client.get("/api/ide/runs/999/events")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "BookRun 不存在。"}
