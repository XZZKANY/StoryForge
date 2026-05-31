from __future__ import annotations

from html import escape
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.domains.artifacts.models import Artifact
from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.artifacts.service import create_artifact
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene


class BookExportError(InputError):
    """BookRun 导出前置条件不满足。"""


def export_book_run_markdown(session: Session, book_run_id: int) -> Artifact:
    """导出 completed BookRun 的 Markdown 正文并登记到 artifacts。"""

    book_run = _completed_book_run(session, book_run_id)
    book = session.get(Book, book_run.book_id)
    if book is None:
        raise BookExportError("作品不存在，无法导出 BookRun。")
    scenes = _approved_scenes(session, book_run)
    lines = ["---", f"book_run_id: {book_run.id}", f"blueprint_id: {book_run.blueprint_id}", "---", "", f"# {book.title}", ""]
    for chapter, scene in scenes:
        lines.extend([f"## 第 {chapter.ordinal} 章 {chapter.title}", "", str(scene.content).strip(), ""])
    content = "\n".join(lines).strip() + "\n"
    return create_artifact(
        session,
        ArtifactCreate(
            workspace_id=book.workspace_id,
            book_id=book.id,
            artifact_type="book_export",
            lineage_key=f"book-run:{book_run.id}:markdown",
            name="book.md",
            storage_uri=f"memory://book-runs/{book_run.id}/book.md",
            mime_type="text/markdown",
            size_bytes=len(content.encode("utf-8")),
            payload={"content": content},
        ),
    )


def export_book_run_audit_report(session: Session, book_run_id: int) -> Artifact:
    """导出 9A 最小审计 JSON，确保每章有生成、评审和批准索引。"""

    book_run = _completed_book_run(session, book_run_id)
    book = session.get(Book, book_run.book_id)
    if book is None:
        raise BookExportError("作品不存在，无法导出 BookRun 审计报告。")
    chapters = list(book_run.progress.get("completed_chapters", []))
    quality = _quality_summary(chapters)
    report = {
        "book_run_id": book_run.id,
        "blueprint_id": book_run.blueprint_id,
        "chapters": chapters,
        "quality_summary": quality["quality_summary"],
        "chapter_quality_scores": quality["chapter_quality_scores"],
        "top_quality_issues": quality["top_quality_issues"],
        "manual_review_recommendations": quality["manual_review_recommendations"],
    }
    for chapter in report["chapters"]:
        if not chapter.get("model_run_id") or not chapter.get("judge_report_id") or not chapter.get("approved_scene_id"):
            raise BookExportError("BookRun 审计证据不完整，无法导出 audit_report.json。")
    return create_artifact(
        session,
        ArtifactCreate(
            workspace_id=book.workspace_id,
            book_id=book.id,
            artifact_type="book_audit_report",
            lineage_key=f"book-run:{book_run.id}:audit-report",
            name="audit_report.json",
            storage_uri=f"memory://book-runs/{book_run.id}/audit_report.json",
            mime_type="application/json",
            size_bytes=len(str(report).encode("utf-8")),
            payload=report,
        ),
    )



def _quality_summary(chapters: list[dict]) -> dict[str, object]:
    """从 BookRun 章节进度聚合质量摘要，缺数据时返回空摘要。"""

    chapter_scores: list[dict[str, object]] = []
    top_issues: list[dict[str, object]] = []
    recommendations: list[str] = []
    scores: list[float] = []
    issue_count = 0
    severe_count = 0
    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue
        chapter_index = chapter.get("chapter_index")
        score = _quality_score(chapter.get("quality_score"))
        issues = _quality_issues(chapter.get("quality_issues"))
        issue_count += len(issues)
        if score is not None:
            scores.append(score)
            chapter_scores.append(
                {
                    "chapter_index": chapter_index,
                    "score": int(score) if float(score).is_integer() else score,
                    "issue_count": len(issues),
                    "status": _quality_status(score, issues),
                }
            )
        for issue in issues:
            if issue.get("severity") in {"高", "严重"}:
                severe_count += 1
            if len(top_issues) < 10:
                top_issues.append({"chapter_index": chapter_index, **issue})
        recommendation = chapter.get("manual_review_recommendation")
        if isinstance(recommendation, str) and recommendation.strip():
            recommendations.append(f"第 {chapter_index} 章：{recommendation.strip()}")
    overall = round(sum(scores) / len(scores)) if scores else None
    return {
        "quality_summary": {
            "overall_quality_score": overall,
            "chapter_count": len(chapters),
            "scored_chapter_count": len(scores),
            "issue_count": issue_count,
            "severe_issue_count": severe_count,
        },
        "chapter_quality_scores": chapter_scores,
        "top_quality_issues": top_issues,
        "manual_review_recommendations": recommendations,
    }


def _quality_score(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _quality_issues(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _quality_status(score: float, issues: list[dict[str, object]]) -> str:
    if any(issue.get("severity") in {"高", "严重"} for issue in issues):
        return "needs_review"
    if score >= 85:
        return "pass"
    if score >= 70:
        return "repair_recommended"
    return "needs_review"

def build_book_run_epub_package(session: Session, book_run_id: int) -> bytes:
    """生成 completed BookRun 的最小 EPUB 二进制包。"""

    book_run = _completed_book_run(session, book_run_id)
    book = session.get(Book, book_run.book_id)
    if book is None:
        raise BookExportError("作品不存在，无法导出 BookRun EPUB。")
    scenes = _approved_scenes(session, book_run)
    return _build_epub_bytes(book, scenes)


def export_book_run_epub(session: Session, book_run_id: int) -> Artifact:
    """导出 completed BookRun 的 EPUB 并登记到 artifacts。"""

    book_run = _completed_book_run(session, book_run_id)
    book = session.get(Book, book_run.book_id)
    if book is None:
        raise BookExportError("作品不存在，无法导出 BookRun EPUB。")
    scenes = _approved_scenes(session, book_run)
    content = _build_epub_bytes(book, scenes)
    chapter_manifest = [
        {
            "chapter_index": chapter.ordinal,
            "chapter_title": chapter.title,
            "scene_id": scene.id,
        }
        for chapter, scene in scenes
    ]
    return create_artifact(
        session,
        ArtifactCreate(
            workspace_id=book.workspace_id,
            book_id=book.id,
            artifact_type="book_epub_export",
            lineage_key=f"book-run:{book_run.id}:epub",
            name="book.epub",
            storage_uri=f"memory://book-runs/{book_run.id}/book.epub",
            mime_type="application/epub+zip",
            size_bytes=len(content),
            payload={
                "format": "epub",
                "book_run_id": book_run.id,
                "blueprint_id": book_run.blueprint_id,
                "chapter_count": len({chapter.ordinal for chapter, _scene in scenes}),
                "manifest": chapter_manifest,
            },
        ),
    )


def _completed_book_run(session: Session, book_run_id: int) -> BookRun:
    book_run = session.get(BookRun, book_run_id)
    if book_run is None:
        raise BookExportError("BookRun 不存在，无法导出。")
    if book_run.status != "completed":
        raise BookExportError("BookRun 尚未完成，无法导出。")
    return book_run


def _approved_scenes(session: Session, book_run: BookRun) -> list[tuple[Chapter, Scene]]:
    rows = session.execute(
        select(Chapter, Scene)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .where(
            Chapter.book_id == book_run.book_id,
            Chapter.status == "approved",
            Scene.status == "approved",
            Scene.content.is_not(None),
        )
        .order_by(Chapter.ordinal, Scene.ordinal)
    ).all()
    scenes = [(chapter, scene) for chapter, scene in rows if scene.content and str(scene.content).strip()]
    if not scenes:
        raise BookExportError("BookRun 没有可导出的已批准正文。")
    return scenes


def _build_epub_bytes(book: Book, scenes: list[tuple[Chapter, Scene]]) -> bytes:
    """将 BookRun 已批准正文组装为 EPUB 3 最小结构。"""

    buffer = BytesIO()
    with ZipFile(buffer, "w") as epub:
        epub.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        epub.writestr(
            "META-INF/container.xml",
            """<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">
  <rootfiles>
    <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\" />
  </rootfiles>
</container>
""",
            compress_type=ZIP_DEFLATED,
        )
        epub.writestr("OEBPS/content.opf", _build_epub_opf(book, scenes), compress_type=ZIP_DEFLATED)
        epub.writestr("OEBPS/nav.xhtml", _build_epub_nav(book, scenes), compress_type=ZIP_DEFLATED)
        for chapter, scene in scenes:
            epub.writestr(
                f"OEBPS/chapters/chapter-{chapter.ordinal}.xhtml",
                _build_chapter_xhtml(book, chapter, scene),
                compress_type=ZIP_DEFLATED,
            )
    return buffer.getvalue()


def _build_epub_opf(book: Book, scenes: list[tuple[Chapter, Scene]]) -> str:
    """生成 EPUB 包描述，声明目录与章节内容。"""

    chapter_items = "\n".join(
        f'    <item id="chapter-{chapter.ordinal}" href="chapters/chapter-{chapter.ordinal}.xhtml" '
        'media-type="application/xhtml+xml" />'
        for chapter, _scene in scenes
    )
    spine_items = "\n".join(
        f'    <itemref idref="chapter-{chapter.ordinal}" />' for chapter, _scene in scenes
    )
    return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<package xmlns=\"http://www.idpf.org/2007/opf\" unique-identifier=\"book-id\" version=\"3.0\">
  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">
    <dc:identifier id=\"book-id\">storyforge-book-run-{book.id}</dc:identifier>
    <dc:title>{escape(book.title)}</dc:title>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\" />
{chapter_items}
  </manifest>
  <spine>
{spine_items}
  </spine>
</package>
"""


def _build_epub_nav(book: Book, scenes: list[tuple[Chapter, Scene]]) -> str:
    """生成 EPUB 目录页，便于阅读器跳转章节。"""

    items = "\n".join(
        f'      <li><a href="chapters/chapter-{chapter.ordinal}.xhtml">'
        f"第 {chapter.ordinal} 章 {escape(chapter.title)}</a></li>"
        for chapter, _scene in scenes
    )
    return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"zh-CN\">
<head>
  <title>{escape(book.title)} 目录</title>
  <meta charset=\"UTF-8\" />
</head>
<body>
  <nav epub:type=\"toc\" id=\"toc\">
    <h1>{escape(book.title)}</h1>
    <ol>
{items}
    </ol>
  </nav>
</body>
</html>
"""


def _build_chapter_xhtml(book: Book, chapter: Chapter, scene: Scene) -> str:
    """将单章已批准正文转成 XHTML。"""

    paragraphs = [part.strip() for part in str(scene.content).splitlines() if part.strip()]
    body = "\n".join(f"  <p>{escape(paragraph)}</p>" for paragraph in paragraphs or [str(scene.content).strip()])
    return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"zh-CN\">
<head>
  <title>第 {chapter.ordinal} 章 {escape(chapter.title)}</title>
  <meta charset=\"UTF-8\" />
</head>
<body>
  <h1>{escape(book.title)}</h1>
  <h2>第 {chapter.ordinal} 章 {escape(chapter.title)}</h2>
{body}
</body>
</html>
"""
