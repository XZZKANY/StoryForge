from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from app.domains.artifacts.models import Artifact
from app.domains.artifacts.service import read_artifact_download
from app.domains.blueprints.service import (
    create_book_blueprint,
    lock_book_blueprint,
    trigger_chapter_plan,
)
from app.domains.book_runs.book_generation import (
    _blueprint_payload,
    _create_generation_book,
    _seed_consistency_data,
)
from app.domains.book_runs.schemas import BookRunCreate
from app.domains.book_runs.service import create_book_run
from app.domains.exports.book_markdown_exporter import (
    export_book_run_markdown,
)


def test_export_uploads_to_s3_when_client_available(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S3 客户端可用时，export 应上传并返回 s3:// URI + 空 payload。"""

    fake_client = MagicMock()
    fake_client.put_object.return_value = {}
    # 覆盖 conftest 的全局禁用，注入假客户端
    monkeypatch.setattr("app.common.s3_client.get_s3_client", lambda: fake_client, raising=False)

    book = _create_generation_book(session, 1)
    _seed_consistency_data(session, book.id)
    blueprint = create_book_blueprint(session, _blueprint_payload(book.id, 1))
    lock_book_blueprint(session, blueprint.id)
    trigger_chapter_plan(session, blueprint.id)
    book_run = create_book_run(
        session,
        BookRunCreate(book_id=book.id, blueprint_id=blueprint.id, token_budget=4000),
    )
    book_run.status = "completed"
    session.commit()

    # 强制创建一个已批准 scene（export 依赖它）
    from app.domains.books.models import Chapter, Scene

    chapter = session.query(Chapter).filter(Chapter.book_id == book.id).first()
    chapter.status = "approved"
    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title="测试场景",
        status="approved",
        content="测试正文。",
    )
    session.add(scene)
    session.commit()

    artifact = export_book_run_markdown(session, book_run.id)
    assert artifact.storage_uri.startswith("s3://storyforge/book-runs/")
    assert artifact.payload.get("uploaded_at")
    assert "content" not in artifact.payload
    fake_client.put_object.assert_called_once()


def test_export_falls_back_to_memory_when_s3_unavailable(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """S3 客户端不可用时，export 应回退到 memory:// + inline payload。"""

    monkeypatch.setattr("app.common.s3_client.get_s3_client", lambda: None)

    book = _create_generation_book(session, 1)
    _seed_consistency_data(session, book.id)
    blueprint = create_book_blueprint(session, _blueprint_payload(book.id, 1))
    lock_book_blueprint(session, blueprint.id)
    trigger_chapter_plan(session, blueprint.id)
    book_run = create_book_run(
        session,
        BookRunCreate(book_id=book.id, blueprint_id=blueprint.id, token_budget=4000),
    )
    book_run.status = "completed"
    session.commit()

    from app.domains.books.models import Chapter, Scene

    chapter = session.query(Chapter).filter(Chapter.book_id == book.id).first()
    chapter.status = "approved"
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="测试场景", status="approved", content="测试正文。")
    session.add(scene)
    session.commit()

    artifact = export_book_run_markdown(session, book_run.id)
    assert artifact.storage_uri.startswith("memory://")
    assert "content" in artifact.payload


def test_export_falls_back_to_memory_when_upload_raises(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """S3 客户端可用但 put_object 抛异常（如 NoSuchBucket）时，export 应回退 memory:// 而非中断。"""

    fake_client = MagicMock()
    fake_client.put_object.side_effect = RuntimeError("NoSuchBucket")
    monkeypatch.setattr("app.common.s3_client.get_s3_client", lambda: fake_client, raising=False)

    book = _create_generation_book(session, 1)
    _seed_consistency_data(session, book.id)
    blueprint = create_book_blueprint(session, _blueprint_payload(book.id, 1))
    lock_book_blueprint(session, blueprint.id)
    trigger_chapter_plan(session, blueprint.id)
    book_run = create_book_run(
        session,
        BookRunCreate(book_id=book.id, blueprint_id=blueprint.id, token_budget=4000),
    )
    book_run.status = "completed"
    session.commit()

    from app.domains.books.models import Chapter, Scene

    chapter = session.query(Chapter).filter(Chapter.book_id == book.id).first()
    chapter.status = "approved"
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="测试场景", status="approved", content="测试正文。")
    session.add(scene)
    session.commit()

    artifact = export_book_run_markdown(session, book_run.id)
    assert artifact.storage_uri.startswith("memory://")
    assert "content" in artifact.payload
    fake_client.put_object.assert_called_once()


def test_download_generates_presigned_url_for_s3_artifact(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S3 artifact 下载应返回 presigned_url + expires_at。"""

    fake_client = MagicMock()
    fake_client.generate_presigned_url.return_value = "https://minio.local/signed?token=xyz"
    monkeypatch.setattr("app.common.s3_client.get_s3_client", lambda: fake_client, raising=False)

    artifact = Artifact(
        workspace_id=1,
        artifact_type="book_export",
        lineage_key="test:1",
        name="book.md",
        storage_uri="s3://storyforge/book-runs/1/book.md",
        mime_type="text/markdown",
        size_bytes=100,
        payload={"uploaded_at": datetime.now(UTC).isoformat()},
        version=1,
    )
    session.add(artifact)
    session.commit()

    download = read_artifact_download(session, artifact.id)
    assert download.download_mode == "presigned_url"
    assert download.presigned_url == "https://minio.local/signed?token=xyz"
    assert download.expires_at is not None
    assert download.content_preview == ""


def test_download_returns_payload_preview_for_memory_artifact(session: Session) -> None:
    """memory:// artifact 下载应返回 payload_preview mode + content_preview。"""

    artifact = Artifact(
        workspace_id=1,
        artifact_type="book_export",
        lineage_key="test:2",
        name="book.md",
        storage_uri="memory://book-runs/2/book.md",
        mime_type="text/markdown",
        size_bytes=50,
        payload={"content": "这是内联正文。"},
        version=1,
    )
    session.add(artifact)
    session.commit()

    download = read_artifact_download(session, artifact.id)
    assert download.download_mode == "payload_preview"
    assert download.content_preview == "这是内联正文。"
    assert download.presigned_url is None


def test_ensure_bucket_creates_when_missing() -> None:
    """head_bucket 探测失败（桶不存在）时，_ensure_bucket 应调 create_bucket。"""

    from app.common.s3_client import _ensure_bucket

    client = MagicMock()
    client.head_bucket.side_effect = RuntimeError("NoSuchBucket")
    _ensure_bucket(client, "storyforge")
    client.create_bucket.assert_called_once_with(Bucket="storyforge")


def test_ensure_bucket_skips_create_when_exists() -> None:
    """head_bucket 成功（桶已存在）时，_ensure_bucket 不应再 create_bucket。"""

    from app.common.s3_client import _ensure_bucket

    client = MagicMock()
    client.head_bucket.return_value = {}
    _ensure_bucket(client, "storyforge")
    client.create_bucket.assert_not_called()


def test_ensure_bucket_swallows_create_failure() -> None:
    """建桶失败不致命：_ensure_bucket 不抛异常，留给 upload_bytes 回退 memory://。"""

    from app.common.s3_client import _ensure_bucket

    client = MagicMock()
    client.head_bucket.side_effect = RuntimeError("NoSuchBucket")
    client.create_bucket.side_effect = RuntimeError("AccessDenied")
    _ensure_bucket(client, "storyforge")  # 不应抛
