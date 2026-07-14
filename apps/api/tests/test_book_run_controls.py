from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint

from app.main import app


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


def test_book_run_control_endpoints_pause_stop_and_retry(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Assistant 控制按钮必须通过 BookRun 原生端点真实更新状态。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    pause_response = client.post(f"/api/book-runs/{created['id']}/pause", json={"reason": "用户暂停检查"})
    assert pause_response.status_code == 200, pause_response.text
    paused = pause_response.json()
    assert paused["status"] == "paused_by_user"
    assert paused["progress"]["pause_reason"] == "用户暂停检查"

    resume_response = client.post(f"/api/book-runs/{created['id']}/resume")
    assert resume_response.status_code == 200, resume_response.text
    assert resume_response.json()["status"] == "running"

    progress = {
        "completed_chapters": [{"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}]
    }
    client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "paused_by_budget", "current_chapter_index": 1, "progress": progress},
    )

    retry_response = client.post(f"/api/book-runs/{created['id']}/retry")
    assert retry_response.status_code == 200, retry_response.text
    retried = retry_response.json()
    assert retried["status"] == "running"
    assert retried["current_chapter_index"] == 2
    assert retried["progress"]["retry_from_chapter_index"] == 2

    stop_response = client.post(f"/api/book-runs/{created['id']}/stop", json={"reason": "用户停止"})
    assert stop_response.status_code == 200, stop_response.text
    stopped = stop_response.json()
    assert stopped["status"] == "stopped"
    assert stopped["progress"]["stop_reason"] == "用户停止"


def test_book_run_control_rejects_extra_sensitive_fields(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 控制请求不得静默接收 API Key 等额外敏感字段。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    response = client.post(
        f"/api/book-runs/{created['id']}/pause",
        json={"reason": "用户暂停", "api_key": "secret-should-not-enter-control-payload"},
    )

    assert response.status_code == 422, response.text
    assert "api_key" in response.text
    assert "secret-should-not-enter-control-payload" not in response.text


def test_patch_book_run_progress_endpoint(client: TestClient, session_factory: sessionmaker[Session]) -> None:
    """Workflow adapter 可通过 HTTP 回填 BookRun completed 状态。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    created_provider_resolution = created["progress"]["provider_resolution"]

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
                ],
                "provider_resolution": {"provider_name": "workflow-shadow", "credential_ref": "secret"},
            },
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"
    assert response.json()["current_chapter_index"] == 3
    assert response.json()["progress"]["provider_resolution"] == created_provider_resolution


def test_progress_update_persists_book_run_latency_aggregates(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 应从已完成章节记录中持久化总、最大和平均 latency。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 3,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "generation_latency_ms": 120},
                    {"chapter_index": 2, "model_run_id": 21, "generation_latency_ms": 80},
                    {"chapter_index": 3, "model_run_id": 31, "generation_latency_ms": 100},
                ],
                "budget": {"tokens_used": 300, "elapsed_time_sec": 9, "estimated_cost": 0.03},
            },
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["total_latency_ms"] == 300
    assert updated["max_latency_ms"] == 120
    assert updated["avg_latency_ms"] == 100


def test_patch_book_run_volume_progress_is_controlled_by_volume_contract(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """卷级摘要只能由受控契约写入，普通 progress 字典不能污染。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    volume_progress = {
        "current_volume": 1,
        "chapter_range": {"start": 1, "end": 3},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 2,
    }

    first_response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "running",
            "current_chapter_index": 2,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}
                ]
            },
            "volume_progress": volume_progress,
        },
    )

    assert first_response.status_code == 200, first_response.text
    first_progress = first_response.json()["progress"]
    assert first_progress["volume"] == volume_progress
    assert first_progress["current_volume"] == 1
    assert first_progress["chapter_range"] == {"start": 1, "end": 3}
    assert first_progress["volume_checkpoint"] == volume_progress

    polluted_response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "awaiting_review",
            "current_chapter_index": 2,
            "progress": {
                "completed_chapters": first_progress["completed_chapters"],
                "volume": {"current_volume": 99},
                "current_volume": 99,
                "chapter_range": {"start": 99, "end": 100},
                "volume_checkpoint": {"current_volume": 99},
            },
        },
    )

    assert polluted_response.status_code == 200, polluted_response.text
    polluted_progress = polluted_response.json()["progress"]
    assert polluted_progress["volume"] == volume_progress
    assert polluted_progress["current_volume"] == 1
    assert polluted_progress["chapter_range"] == {"start": 1, "end": 3}
    assert polluted_progress["volume_checkpoint"] == volume_progress

    schemas = app.openapi()["components"]["schemas"]
    volume_schema = schemas["BookRunProgressUpdate"]["properties"]["volume_progress"]
    assert "BookRunVolumeProgress" in schemas
    assert {"$ref": "#/components/schemas/BookRunVolumeProgress"} in volume_schema["anyOf"]

