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


def test_markdown_export_returns_404_when_book_missing(client: TestClient) -> None:
    """作品不存在时导出返回 404。"""

    response = client.get("/api/books/9999/exports/markdown")

    assert response.status_code == 404
    assert response.json()["detail"] == "作品不存在，无法导出。"


def test_markdown_export_returns_404_when_no_approved_body(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """作品没有已批准正文时导出返回 404。"""

    with session_factory() as session:
        book = Book(title="空白草稿", status="draft", premise="尚未批准。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="草稿章", status="draft", summary="未批准。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="草稿场景", status="draft", content="草稿正文")
        session.add(scene)
        session.commit()
        book_id = book.id

    response = client.get(f"/api/books/{book_id}/exports/markdown")

    assert response.status_code == 404
    assert response.json()["detail"] == "作品没有可导出的已批准正文。"


def test_markdown_export_filters_unapproved_chapters_and_scenes(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """未批准章节和未批准场景不会出现在导出内容中。"""

    with session_factory() as session:
        book = Book(title="过滤测试", status="draft", premise="验证导出过滤。")
        session.add(book)
        session.flush()
        approved_chapter = Chapter(book_id=book.id, ordinal=1, title="可导出章", status="approved", summary="已批准。")
        draft_chapter = Chapter(book_id=book.id, ordinal=2, title="未批准章", status="draft", summary="未批准。")
        session.add_all([approved_chapter, draft_chapter])
        session.flush()
        session.add_all(
            [
                Scene(chapter_id=approved_chapter.id, ordinal=1, title="已批准场景", status="approved", content="应该导出的正文"),
                Scene(chapter_id=approved_chapter.id, ordinal=2, title="未批准场景", status="draft", content="不应导出的场景正文"),
                Scene(chapter_id=draft_chapter.id, ordinal=1, title="章节未批准场景", status="approved", content="不应导出的章节正文"),
            ]
        )
        session.commit()
        book_id = book.id

    response = client.get(f"/api/books/{book_id}/exports/markdown")

    assert response.status_code == 200, response.text
    assert "应该导出的正文" in response.text
    assert "不应导出的场景正文" not in response.text
    assert "不应导出的章节正文" not in response.text
    assert "未批准章" not in response.text


def test_markdown_export_orders_chapters_and_scenes_by_ordinal(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """多章节多场景按章节序号和场景序号稳定排序。"""

    with session_factory() as session:
        book = Book(title="排序测试", status="draft", premise="验证导出排序。")
        session.add(book)
        session.flush()
        chapter_two = Chapter(book_id=book.id, ordinal=2, title="第二章", status="approved", summary="后导出。")
        chapter_one = Chapter(book_id=book.id, ordinal=1, title="第一章", status="approved", summary="先导出。")
        session.add_all([chapter_two, chapter_one])
        session.flush()
        session.add_all(
            [
                Scene(chapter_id=chapter_two.id, ordinal=2, title="第二章第二场", status="approved", content="四号正文"),
                Scene(chapter_id=chapter_one.id, ordinal=2, title="第一章第二场", status="approved", content="二号正文"),
                Scene(chapter_id=chapter_two.id, ordinal=1, title="第二章第一场", status="approved", content="三号正文"),
                Scene(chapter_id=chapter_one.id, ordinal=1, title="第一章第一场", status="approved", content="一号正文"),
            ]
        )
        session.commit()
        book_id = book.id

    response = client.get(f"/api/books/{book_id}/exports/markdown")

    assert response.status_code == 200, response.text
    ordered_markers = ["## 第 1 章 第一章", "一号正文", "二号正文", "## 第 2 章 第二章", "三号正文", "四号正文"]
    positions = [response.text.index(marker) for marker in ordered_markers]
    assert positions == sorted(positions)
    assert response.text.index("### 第一章第一场") < response.text.index("### 第一章第二场")
    assert response.text.index("### 第二章第一场") < response.text.index("### 第二章第二场")
