from __future__ import annotations

from dataclasses import dataclass
from html import escape
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter, Scene


class ExportNotFoundError(ValueError):
    """作品或可导出的已批准正文不存在时抛出。"""


@dataclass(frozen=True)
class ApprovedScene:
    """导出时使用的已批准章节场景快照。"""

    chapter_ordinal: int
    chapter_title: str
    scene_ordinal: int
    scene_title: str
    content: str


def build_markdown_export(session: Session, book_id: int) -> str:
    """生成包含书名、章节标题和已批准正文的 Markdown。"""

    book, scenes = _load_export_source(session, book_id)
    lines = [f"# {book.title}", ""]
    current_chapter: tuple[int, str] | None = None
    for scene in scenes:
        chapter_key = (scene.chapter_ordinal, scene.chapter_title)
        if chapter_key != current_chapter:
            if current_chapter is not None:
                lines.append("")
            lines.append(f"## 第 {scene.chapter_ordinal} 章 {scene.chapter_title}")
            lines.append("")
            current_chapter = chapter_key
        if len([item for item in scenes if item.chapter_ordinal == scene.chapter_ordinal]) > 1:
            lines.append(f"### {scene.scene_title}")
            lines.append("")
        lines.append(scene.content.strip())
        lines.append("")
    return "\n".join(lines).strip() + "\n"

def build_epub_export(session: Session, book_id: int) -> bytes:
    """生成最小有效 EPUB 文件，Phase 1 不引入额外依赖。"""

    book, scenes = _load_export_source(session, book_id)
    xhtml = _build_content_xhtml(book, scenes)
    opf = _build_content_opf(book)
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
        epub.writestr("OEBPS/content.xhtml", xhtml, compress_type=ZIP_DEFLATED)
        epub.writestr("OEBPS/content.opf", opf, compress_type=ZIP_DEFLATED)
    return buffer.getvalue()


def _load_export_source(session: Session, book_id: int) -> tuple[Book, list[ApprovedScene]]:
    """读取作品及其已批准正文，缺失时交由路由层转换为 404。"""

    book = session.get(Book, book_id)
    if book is None:
        raise ExportNotFoundError("作品不存在，无法导出。")

    rows = session.execute(
        select(Chapter, Scene)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .where(
            Chapter.book_id == book.id,
            Chapter.status == "approved",
            Scene.status == "approved",
            Scene.content.is_not(None),
        )
        .order_by(Chapter.ordinal, Chapter.id, Scene.ordinal, Scene.id)
    ).all()
    scenes = [
        ApprovedScene(
            chapter_ordinal=chapter.ordinal,
            chapter_title=chapter.title,
            scene_ordinal=scene.ordinal,
            scene_title=scene.title,
            content=str(scene.content),
        )
        for chapter, scene in rows
        if scene.content and str(scene.content).strip()
    ]
    if not scenes:
        raise ExportNotFoundError("作品没有可导出的已批准正文。")
    return book, scenes

def _build_content_xhtml(book: Book, scenes: list[ApprovedScene]) -> str:
    """将已批准正文转为 EPUB 使用的单页 XHTML。"""

    parts = [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        '<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">',
        "<head>",
        f"<title>{escape(book.title)}</title>",
        '<meta charset="UTF-8" />',
        "</head>",
        "<body>",
        f"<h1>{escape(book.title)}</h1>",
    ]
    current_chapter: tuple[int, str] | None = None
    for scene in scenes:
        chapter_key = (scene.chapter_ordinal, scene.chapter_title)
        if chapter_key != current_chapter:
            parts.append(f"<h2>第 {scene.chapter_ordinal} 章 {escape(scene.chapter_title)}</h2>")
            current_chapter = chapter_key
        paragraphs = [paragraph.strip() for paragraph in scene.content.splitlines() if paragraph.strip()]
        for paragraph in paragraphs or [scene.content.strip()]:
            parts.append(f"<p>{escape(paragraph)}</p>")
    parts.extend(["</body>", "</html>"])
    return "\n".join(parts)


def _build_content_opf(book: Book) -> str:
    """生成最小包描述文件，声明单个 XHTML 内容项。"""

    escaped_title = escape(book.title)
    return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<package xmlns=\"http://www.idpf.org/2007/opf\" unique-identifier=\"book-id\" version=\"3.0\">
  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">
    <dc:identifier id=\"book-id\">storyforge-book-{book.id}</dc:identifier>
    <dc:title>{escaped_title}</dc:title>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id=\"content\" href=\"content.xhtml\" media-type=\"application/xhtml+xml\" />
  </manifest>
  <spine>
    <itemref idref=\"content\" />
  </spine>
</package>
"""
