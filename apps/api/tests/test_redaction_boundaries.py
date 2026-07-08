from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.common.redaction import REDACTED, is_sensitive_key
from app.domains.artifacts.models import Artifact
from app.domains.books.models import Book, Chapter
from app.domains.events.models import EventLog
from app.domains.model_runs.models import ModelRun
from app.domains.retrieval.models import RetrievalSource
from app.domains.series.models import Series
from app.domains.timeline.models import TimelineEventRecord
from app.domains.workspaces.models import Workspace


def _seed_redaction_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="红action团队", slug="redaction-team", status="active", seat_limit=3)
        book = Book(title="边界测试", status="draft", premise="验证凭据不进入证据链。", workspace_id=None)
        series = Series(title="边界系列", status="active", description="检索资料源测试。")
        session.add_all([workspace, book, series])
        session.flush()
        book.workspace_id = workspace.id
        chapter = Chapter(book_id=book.id, ordinal=1, title="第一章", status="draft")
        session.add(chapter)
        session.commit()
        return {
            "workspace_id": workspace.id,
            "book_id": book.id,
            "chapter_id": chapter.id,
            "series_id": series.id,
        }


def test_validation_error_redacts_rejected_secret_input(client: TestClient) -> None:
    """FastAPI 422 响应可暴露字段名，但不得回显被拒绝的凭据值。"""

    response = client.post(
        "/api/assistant/sessions",
        json={
            "title": "错误凭据测试",
            "task_type": "trial_generation",
            "api_key": "secret-validation-value",
            "messages": [{"role": "user", "content": "写一章"}],
        },
    )

    assert response.status_code == 422, response.text
    assert "api_key" in response.text
    assert "secret-validation-value" not in response.text


def test_redaction_key_detection_preserves_budget_and_usage_fields() -> None:
    assert is_sensitive_key("api_key") is True
    assert is_sensitive_key("access_token") is True
    assert is_sensitive_key("token") is True
    assert is_sensitive_key("token_budget") is False
    assert is_sensitive_key("token_usage") is False
    assert is_sensitive_key("credential_status") is False
    assert is_sensitive_key("has_api_key") is False


def test_event_payload_redacted_before_response_and_storage(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    scope = _seed_redaction_scope(session_factory)

    response = client.post(
        "/api/events",
        json={
            "workspace_id": scope["workspace_id"],
            "book_id": scope["book_id"],
            "event_type": "redaction.test",
            "source": "pytest",
            "payload": {
                "api_key": "secret-event-value",
                "note": "Authorization: Bearer sk-secret-event-token-123456",
            },
        },
    )

    assert response.status_code == 201, response.text
    assert "secret-event-value" not in response.text
    assert "sk-secret-event-token-123456" not in response.text
    body = response.json()
    assert body["payload"]["api_key"] == REDACTED
    assert REDACTED in body["payload"]["note"]

    with session_factory() as session:
        stored = session.get(EventLog, body["id"])

    assert stored is not None
    assert stored.payload["api_key"] == REDACTED
    assert "sk-secret-event-token-123456" not in stored.payload["note"]


def test_model_run_redacts_summaries_payload_and_error_before_storage(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    response = client.post(
        "/api/model-runs",
        json={
            "provider_name": "openai-global",
            "model_name": "gpt-5.5",
            "capability": "llm",
            "input_summary": "prompt api_key=secret-model-input-value",
            "output_summary": "output token=secret-model-output-value",
            "error_message": "upstream said Bearer sk-secret-model-error-123456",
            "payload": {"apiKey": "secret-model-payload-value"},
        },
    )

    assert response.status_code == 201, response.text
    for leaked in (
        "secret-model-input-value",
        "secret-model-output-value",
        "sk-secret-model-error-123456",
        "secret-model-payload-value",
    ):
        assert leaked not in response.text
    body = response.json()
    assert body["payload"]["apiKey"] == REDACTED

    with session_factory() as session:
        stored = session.get(ModelRun, body["id"])

    assert stored is not None
    assert "secret-model-input-value" not in stored.input_summary
    assert "secret-model-output-value" not in stored.output_summary
    assert "sk-secret-model-error-123456" not in stored.error_message
    assert stored.payload["apiKey"] == REDACTED


def test_artifact_payload_and_download_preview_are_redacted(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    scope = _seed_redaction_scope(session_factory)

    response = client.post(
        "/api/artifacts",
        json={
            "workspace_id": scope["workspace_id"],
            "book_id": scope["book_id"],
            "artifact_type": "upload",
            "lineage_key": "redaction-artifact",
            "name": "红action附件",
            "storage_uri": "memory://redaction-artifact.txt",
            "mime_type": "text/plain",
            "payload": {
                "api_key": "secret-artifact-value",
                "content": "artifact body token=secret-artifact-content",
            },
        },
    )

    assert response.status_code == 201, response.text
    assert "secret-artifact-value" not in response.text
    assert "secret-artifact-content" not in response.text
    body = response.json()
    assert body["payload"]["api_key"] == REDACTED

    download = client.get(
        f"/api/artifacts/{body['id']}/download",
        params={"workspace_id": scope["workspace_id"]},
    )
    assert download.status_code == 200, download.text
    assert "secret-artifact-content" not in download.text
    assert REDACTED in download.json()["content_preview"]

    with session_factory() as session:
        stored = session.get(Artifact, body["id"])

    assert stored is not None
    assert stored.payload["api_key"] == REDACTED
    assert "secret-artifact-content" not in stored.payload["content"]


def test_timeline_payload_redacted_before_response_and_storage(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    scope = _seed_redaction_scope(session_factory)

    response = client.post(
        "/api/timeline-events",
        json={
            "project_id": scope["workspace_id"],
            "book_id": scope["book_id"],
            "volume_id": 1,
            "chapter_id": scope["chapter_id"],
            "time_order": 1,
            "summary": "林岚收到第一封信。",
            "payload": {"api_key": "secret-timeline-value"},
        },
    )

    assert response.status_code == 201, response.text
    assert "secret-timeline-value" not in response.text
    body = response.json()
    assert body["payload"]["api_key"] == REDACTED

    with session_factory() as session:
        stored = session.get(TimelineEventRecord, body["id"])

    assert stored is not None
    assert stored.payload["api_key"] == REDACTED


def test_retrieval_source_payload_redacted_before_response_and_storage(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    scope = _seed_redaction_scope(session_factory)

    response = client.post(
        "/api/retrieval/sources",
        json={
            "book_id": scope["book_id"],
            "series_id": scope["series_id"],
            "source_type": "reference_doc",
            "title": "灯塔港档案",
            "content_text": "灯塔信号每七分钟重复一次。林岚必须隐藏伤势。",
            "payload": {"api_key": "secret-retrieval-value"},
        },
    )

    assert response.status_code == 201, response.text
    assert "secret-retrieval-value" not in response.text
    body = response.json()
    assert body["payload"]["api_key"] == REDACTED

    listing = client.get("/api/retrieval/sources", params={"book_id": scope["book_id"]})
    assert listing.status_code == 200, listing.text
    assert "secret-retrieval-value" not in listing.text

    with session_factory() as session:
        stored = session.get(RetrievalSource, body["id"])

    assert stored is not None
    assert stored.payload["api_key"] == REDACTED


def test_agent_safe_summary_redacts_sensitive_keys_and_token_text() -> None:
    from app.domains.agent_runs.runtime import _safe_summary

    summary = _safe_summary(
        {
            "api_key": "secret-summary-value",
            "notes": "Bearer sk-secret-summary-token-123456",
            "content": "正文不应进入摘要全文。",
        }
    )

    assert summary["api_key"] == REDACTED
    assert summary["notes"] == f"Bearer {REDACTED}"
    assert summary["content_chars"] == len("正文不应进入摘要全文。")
