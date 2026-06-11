from __future__ import annotations

from io import BytesIO
from zipfile import ZipFile

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.exports.book_markdown_exporter import build_book_run_epub_package, export_book_run_epub
from app.domains.workspaces.models import Workspace


def test_book_run_epub_export_writes_artifact_with_valid_structure(
    session_factory: sessionmaker[Session],
) -> None:
    """完成的 BookRun 应导出可结构检查的 EPUB 制品。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)

        artifact = export_book_run_epub(session, book_run_id)

        assert artifact.name == "book.epub"
        assert artifact.mime_type == "application/epub+zip"
        assert artifact.payload["format"] == "epub"
        assert artifact.payload["book_run_id"] == book_run_id
        assert artifact.payload["chapter_count"] == 3
        epub_bytes = build_book_run_epub_package(session, book_run_id)
        with ZipFile(BytesIO(epub_bytes)) as epub:
            names = set(epub.namelist())
            assert "mimetype" in names
            assert "META-INF/container.xml" in names
            assert "OEBPS/content.opf" in names
            assert "OEBPS/nav.xhtml" in names
            assert "OEBPS/chapters/chapter-1.xhtml" in names
            assert epub.read("mimetype") == b"application/epub+zip"
            chapter = epub.read("OEBPS/chapters/chapter-1.xhtml").decode("utf-8")
        assert "雾港航线" in chapter
        assert "第一章正文" in chapter


def test_book_run_epub_export_endpoint_returns_artifact(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun EPUB 导出 API 应返回 book.epub 制品元数据。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)
        workspace_id = session.get(BookRun, book_run_id).workspace_id

    response = client.post(f"/api/book-runs/{book_run_id}/exports/epub", params={"workspace_id": workspace_id})

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["name"] == "book.epub"
    assert payload["mime_type"] == "application/epub+zip"
    assert payload["payload"]["format"] == "epub"
    assert payload["payload"]["chapter_count"] == 3


def _seed_completed_book_run(session: Session) -> int:
    workspace = Workspace(title="EPUB 导出工作区", slug="epub-export-workspace", status="active")
    session.add(workspace)
    session.flush()
    book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。", workspace_id=workspace.id)
    session.add(book)
    session.flush()
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="林岚在雾港追查失真的灯塔信号。",
        tone="克制悬疑",
        target_word_count=4500,
        target_chapter_count=3,
        chapter_word_count_min=1000,
        chapter_word_count_max=1800,
        status="locked",
        version=2,
        metadata_={},
    )
    session.add(blueprint)
    session.flush()
    completed = []
    chapter_names = {1: "第一", 2: "第二", 3: "第三"}
    for index in range(1, 4):
        chapter = Chapter(book_id=book.id, ordinal=index, title=f"雾港航线 {index}", status="approved")
        session.add(chapter)
        session.flush()
        scene = Scene(
            chapter_id=chapter.id,
            ordinal=1,
            title=f"第 {index} 章场景",
            status="approved",
            content=f"{chapter_names[index]}章正文",
        )
        session.add(scene)
        session.flush()
        completed.append(
            {
                "chapter_index": index,
                "model_run_id": index * 10 + 1,
                "judge_report_id": index * 10 + 2,
                "repair_patch_id": None,
                "approved_scene_id": scene.id,
                "memory_extract_id": index * 10 + 4,
            }
        )
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="completed",
        current_chapter_index=3,
        total_chapters=3,
        progress={"completed_chapters": completed},
    )
    session.add(book_run)
    session.commit()
    return book_run.id
