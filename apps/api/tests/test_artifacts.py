from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book, Chapter, Scene
from app.main import app

import pytest


@pytest.fixture()
def artifact_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="approved", premise="林岚追查信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="approved", summary="林岚抵达港口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="approved", content="林岚克制地完成港口谈判。")
        session.add(scene)
        session.commit()
        return {"book_id": book.id}


def test_exports_and_manual_artifacts_are_registered(client: TestClient, artifact_scope: dict[str, int]) -> None:
    markdown = client.get(f"/api/books/{artifact_scope['book_id']}/exports/markdown")
    assert markdown.status_code == 200, markdown.text
    epub = client.get(f"/api/books/{artifact_scope['book_id']}/exports/epub")
    assert epub.status_code == 200, epub.text

    upload = client.post(
        "/api/artifacts",
        json={
            "book_id": artifact_scope["book_id"],
            "artifact_type": "upload",
            "lineage_key": "upload-archive",
            "name": "灯塔港设定附件",
            "storage_uri": "memory://uploads/lighthouse-archive.txt",
            "mime_type": "text/plain",
            "size_bytes": 128,
            "payload": {"purpose": "reference"},
        },
    )
    assert upload.status_code == 201, upload.text

    listing = client.get("/api/artifacts", params={"book_id": artifact_scope["book_id"]})
    assert listing.status_code == 200
    artifact_types = {item["artifact_type"] for item in listing.json()}
    assert {"export", "upload"}.issubset(artifact_types)

    artifact_id = upload.json()["id"]
    detail = client.get(f"/api/artifacts/{artifact_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["name"] == "灯塔港设定附件"
    assert detail.json()["payload"]["purpose"] == "reference"

    download = client.get(f"/api/artifacts/{artifact_id}/download")
    assert download.status_code == 200, download.text
    assert download.json()["download_mode"] == "payload_preview"
    assert download.json()["payload_summary"]["purpose"] == "reference"
    assert "灯塔港设定附件" in download.json()["content_preview"]


def test_artifact_detail_returns_404_for_missing_artifact(client: TestClient) -> None:
    detail = client.get("/api/artifacts/999999")
    assert detail.status_code == 404
    assert "制品不存在" in detail.json()["detail"]

    download = client.get("/api/artifacts/999999/download")
    assert download.status_code == 404
    assert "制品不存在" in download.json()["detail"]
