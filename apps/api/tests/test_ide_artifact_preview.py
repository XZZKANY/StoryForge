from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.artifacts.service import create_artifact
from app.domains.books.models import Book


def test_read_ide_artifact_preview_returns_preview_versions_and_trace(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """IDE Artifact Viewer 需要一次读取预览、下载摘要、版本和反向追溯链路。"""

    with session_factory() as session:
        book = Book(title="雾港航线", status="approved", premise="调查灯塔。")
        session.add(book)
        session.flush()
        create_artifact(
            session,
            ArtifactCreate(
                book_id=book.id,
                artifact_type="book_export",
                lineage_key="book-run:42:markdown",
                name="book.md",
                storage_uri="memory://book-runs/42/book-v1.md",
                mime_type="text/markdown",
                payload={"content": "# 旧版\n", "book_run_id": 42, "model_run_id": 101, "approved_scene_id": 303},
            ),
        )
        latest = create_artifact(
            session,
            ArtifactCreate(
                book_id=book.id,
                artifact_type="book_export",
                lineage_key="book-run:42:markdown",
                name="book.md",
                storage_uri="memory://book-runs/42/book-v2.md",
                mime_type="text/markdown",
                payload={
                    "content": "# 雾港航线\n\n正文",
                    "book_run_id": 42,
                    "model_run_id": 101,
                    "judge_report_id": 202,
                    "approved_scene_id": 303,
                },
            ),
        )
        artifact_id = latest.id

    response = client.get(f"/api/ide/artifacts/{artifact_id}/preview")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["artifact"]["id"] == artifact_id
    assert body["preview"]["format"] == "markdown"
    assert "# 雾港航线" in body["preview"]["content_preview"]
    assert body["download"]["download_mode"] == "payload_preview"
    assert [item["version"] for item in body["versions"]] == [1, 2]
    trace = body["trace"]
    assert trace["book_run"]["id"] == 42
    assert trace["book_run"]["href"] == "/ide?panel.bottom=runs&book_run=42"
    assert trace["model_run"]["id"] == 101
    assert trace["model_run"]["href"] == "/ide?panel.bottom=runs&model_run=101"
    assert trace["approve"]["id"] == 303
    assert trace["approve"]["href"] == "/ide?tab=scene:303"


def test_read_ide_artifact_preview_extracts_trace_from_audit_chapters(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """audit_report.json 只有 chapters 时也应能提取 BookRun → ModelRun → Approve 链路。"""

    with session_factory() as session:
        artifact = create_artifact(
            session,
            ArtifactCreate(
                artifact_type="book_audit_report",
                lineage_key="book-run:77:audit-report",
                name="audit_report.json",
                storage_uri="memory://book-runs/77/audit_report.json",
                mime_type="application/json",
                payload={
                    "book_run_id": 77,
                    "chapters": [
                        {"chapter_index": 1, "model_run_id": 501, "judge_report_id": 502, "approved_scene_id": 503}
                    ],
                },
            ),
        )
        artifact_id = artifact.id

    response = client.get(f"/api/ide/artifacts/{artifact_id}/preview")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["preview"]["format"] == "json"
    assert body["trace"]["book_run"]["id"] == 77
    assert body["trace"]["model_run"]["id"] == 501
    assert body["trace"]["judge_report"]["id"] == 502
    assert body["trace"]["approve"]["id"] == 503


def test_read_ide_artifact_preview_returns_404_for_missing_artifact(client: TestClient) -> None:
    """不存在的制品预览应返回 404。"""

    response = client.get("/api/ide/artifacts/999999/preview")

    assert response.status_code == 404
    assert "制品不存在" in response.json()["detail"]
