from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint


def test_book_run_budget_gate_stores_all_hard_limits(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Phase 9B 预算门禁：BookRun 启动保存 token、时间和章节上限。"""

    scope = seed_locked_blueprint(session_factory)

    response = client.post(
        "/api/book-runs",
        json={**scope, "token_budget": 100, "time_budget_sec": 60, "chapter_budget": 1},
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["token_budget"] == 100
    assert payload["time_budget_sec"] == 60
    assert payload["chapter_budget"] == 1


def test_book_run_budget_gate_persists_usage_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Phase 9B 预算门禁：progress 回填后可读取累计 token 和剩余预算。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 100}).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "paused_by_budget",
            "current_chapter_index": 1,
            "progress": {"completed_chapters": [], "budget": {"tokens_used": 120, "elapsed_time_sec": 61, "estimated_cost": 0.08}},
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "paused_by_budget"
    assert payload["tokens_used"] == 120
    assert payload["elapsed_time_sec"] == 61
    assert payload["estimated_cost"] == 0.08
    assert payload["cost_summary"] == {
        "estimated_cost": 0.08,
        "token_budget": 100,
        "tokens_remaining": 0,
    }
