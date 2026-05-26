from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.workspaces.models import Workspace


@pytest.fixture()
def evaluation_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="Phase4 Eval Team", slug="phase4-eval-team", status="active", seat_limit=2)
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
        session.add_all([workspace, book])
        session.commit()
        return {"workspace_id": workspace.id, "book_id": book.id}


def test_evaluation_case_and_run_produce_metrics(client: TestClient, evaluation_scope: dict[str, int]) -> None:
    case = client.post(
        "/api/evaluations/cases",
        json={
            "workspace_id": evaluation_scope["workspace_id"],
            "book_id": evaluation_scope["book_id"],
            "case_name": "港口谈判一致性基准",
            "case_type": "consistency",
            "input_payload": {"scene_count": 2},
            "expected_payload": {"open_loop_count": 1},
        },
    )
    assert case.status_code == 201, case.text

    run = client.post(
        "/api/evaluations/runs",
        json={
            "case_id": case.json()["id"],
            "observed_payload": {
                "scene_count": 2,
                "open_issue_count": 1,
                "repair_attempts": 2,
                "repair_accepted": 1,
                "suggestions_total": 4,
                "suggestions_accepted": 2,
                "open_loop_count": 1,
                "failed_samples": [
                    {
                        "id": "港口谈判-一致性",
                        "reason": "角色动机与上一章摘要冲突",
                        "chapter_id": 7,
                        "artifact_id": 11,
                        "repair_hint": "回到 Studio 对第 7 章重新执行 Judge/Repair。",
                    }
                ],
            },
        },
    )
    assert run.status_code == 201, run.text
    result = run.json()
    assert result["metrics"]["consistency_error_rate"] == 0.5
    assert result["metrics"]["repair_success_rate"] == 0.5
    assert result["metrics"]["user_acceptance_rate"] == 0.5
    assert result["metrics"]["open_loop_count"] == 1
    assert result["metrics"]["failed_sample_count"] == 1

    listing = client.get("/api/evaluations/runs", params={"workspace_id": evaluation_scope["workspace_id"]})
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    detail = client.get(f"/api/evaluations/runs/{result['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["failed_sample_count"] == 1
    assert detail.json()["trend_points"][0]["metric"] == "consistency_error_rate"
    assert detail.json()["studio_feedback_href"] == "/studio?chapter_id=7"

    failed_samples = client.get(f"/api/evaluations/runs/{result['id']}/failed-samples")
    assert failed_samples.status_code == 200, failed_samples.text
    sample = failed_samples.json()[0]
    assert sample["reason"] == "角色动机与上一章摘要冲突"
    assert sample["chapter_id"] == 7
    assert sample["artifact_id"] == 11
    assert sample["studio_href"] == "/studio?chapter_id=7"


def test_evaluation_run_rejects_scope_mismatch_when_case_is_provided(
    client: TestClient,
    evaluation_scope: dict[str, int],
    session_factory: sessionmaker[Session],
) -> None:
    case = client.post(
        "/api/evaluations/cases",
        json={
            "workspace_id": evaluation_scope["workspace_id"],
            "book_id": evaluation_scope["book_id"],
            "case_name": "作用域一致性基准",
            "case_type": "consistency",
            "input_payload": {},
            "expected_payload": {},
        },
    )
    assert case.status_code == 201, case.text

    with session_factory() as session:
        other_workspace = Workspace(title="Phase4 Other Team", slug="phase4-other-team", status="active", seat_limit=2)
        other_book = Book(title="错位星图", status="draft", premise="另一本书的基准。")
        session.add_all([other_workspace, other_book])
        session.commit()
        other_scope = {"workspace_id": other_workspace.id, "book_id": other_book.id}

    run = client.post(
        "/api/evaluations/runs",
        json={
            "case_id": case.json()["id"],
            "workspace_id": other_scope["workspace_id"],
            "book_id": other_scope["book_id"],
            "observed_payload": {"scene_count": 1},
        },
    )

    assert run.status_code == 400, run.text
    assert "评测运行作用域必须与评测用例一致" in run.json()["detail"]


def test_evaluation_run_rejects_invalid_observed_payload_number(client: TestClient) -> None:
    run = client.post(
        "/api/evaluations/runs",
        json={"observed_payload": {"scene_count": "不是数字"}},
    )

    assert run.status_code == 400, run.text
    assert "scene_count 必须是非负整数" in run.json()["detail"]


@pytest.mark.parametrize(
    "observed_payload",
    [
        {"scene_count": 2, "open_issue_count": 3},
        {"repair_attempts": 2, "repair_accepted": 3},
        {"suggestions_total": 2, "suggestions_accepted": 3},
        {"open_loop_count": -1},
    ],
)
def test_evaluation_run_rejects_invalid_metric_boundaries(
    client: TestClient,
    observed_payload: dict[str, int],
) -> None:
    run = client.post("/api/evaluations/runs", json={"observed_payload": observed_payload})

    assert run.status_code == 400, run.text
    assert "评测指标数值不合法" in run.json()["detail"]


def test_evaluation_run_detail_returns_404_for_missing_run(client: TestClient) -> None:
    detail = client.get("/api/evaluations/runs/999999")
    assert detail.status_code == 404
    assert "评测运行不存在" in detail.json()["detail"]

    failed_samples = client.get("/api/evaluations/runs/999999/failed-samples")
    assert failed_samples.status_code == 404
    assert "评测运行不存在" in failed_samples.json()["detail"]
