from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint

from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress
from scripts.measure_ide_sse_latency import measure_ide_sse_latency


def test_measure_ide_sse_latency_records_p95_budget_report(
    client: TestClient,
    session_factory: sessionmaker[Session],
    tmp_path: Path,
) -> None:
    """IDE SSE 延迟基线应记录 p95、预算阈值和事件内容证据。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 500}).json()
    with session_factory() as session:
        apply_book_run_progress(
            session,
            created["id"],
            BookRunProgressUpdate(
                status="completed",
                current_chapter_index=3,
                progress={
                    "completed_chapters": [
                        {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
                        {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
                        {"chapter_index": 3, "model_run_id": 31, "judge_report_id": 32, "approved_scene_id": 33},
                    ],
                    "budget": {"tokens_used": 420, "estimated_cost": 0.25},
                },
            ),
        )

    report_path = tmp_path / "ide-sse-latency-baseline.json"
    report = measure_ide_sse_latency(client, created["id"], samples=5, output_path=report_path)

    assert report["route"] == f"/api/ide/runs/{created['id']}/events"
    assert report["samples"] == 5
    assert report["target_p95_ms"] == 500
    assert report["blocking_p95_ms"] == 1200
    assert report["status"] == "pass"
    assert 0 <= report["p95_ms"] < 500
    assert len(report["latencies_ms"]) == 5
    assert report["events"] == ["progress", "checkpoint", "budget", "completed"]
    assert report["content_type"].startswith("text/event-stream")
    assert report_path.exists()
    assert json.loads(report_path.read_text(encoding="utf-8"))["p95_ms"] == report["p95_ms"]
