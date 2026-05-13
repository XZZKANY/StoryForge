from __future__ import annotations

from collections.abc import Generator
from io import BytesIO
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book, Chapter, Scene
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个导出测试使用独立内存数据库。"""

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    """覆盖数据库依赖，确保导出 API 完全本地可重复。"""

    def override_get_session() -> Generator[Session, None, None]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def approved_story(session_factory: sessionmaker[Session]) -> dict[str, int | str]:
    """准备包含已批准正文的单章作品。"""

    approved_content = "林岚按住仍在发疼的左臂，克制地完成港口谈判。"
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查失真的灯塔信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="approved", summary="林岚抵达港口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="approved", content=approved_content)
        session.add(scene)
        session.commit()
        return {"book_id": book.id, "approved_content": approved_content}

def test_markdown_export_contains_book_title_chapter_title_and_approved_body(
    client: TestClient,
    approved_story: dict[str, int | str],
) -> None:
    """Markdown 导出包含作品名、章节标题和已批准正文。"""

    response = client.get(f"/api/books/{approved_story['book_id']}/exports/markdown")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/markdown")
    assert "# 灯塔余烬" in response.text
    assert "## 第 1 章 旧伤" in response.text
    assert str(approved_story["approved_content"]) in response.text


def test_epub_export_creates_minimal_valid_zip_with_approved_body(
    client: TestClient,
    approved_story: dict[str, int | str],
) -> None:
    """EPUB 导出使用标准 zip 结构并包含已批准正文。"""

    response = client.get(f"/api/books/{approved_story['book_id']}/exports/epub")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/epub+zip"
    with ZipFile(BytesIO(response.content)) as epub:
        names = set(epub.namelist())
        assert "mimetype" in names
        assert "META-INF/container.xml" in names
        assert "OEBPS/content.xhtml" in names
        assert epub.read("mimetype") == b"application/epub+zip"
        content = epub.read("OEBPS/content.xhtml").decode("utf-8")
    assert "灯塔余烬" in content
    assert "旧伤" in content
    assert str(approved_story["approved_content"]) in content
