from __future__ import annotations

import json
from datetime import UTC, datetime
from html import escape
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.common.s3_client import upload_bytes
from app.domains.artifacts.models import Artifact
from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.artifacts.service import ArtifactForbiddenError, create_artifact
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.workflow_skill_audit_bridge import derive_book_run_skill_chain
from app.domains.books.models import Book, Chapter, Scene
from app.domains.judge.types import FORBIDDEN_DRAFT_TERMS
from app.domains.story_state.models import StoryStateEvent, StoryStateLedger


class BookExportError(InputError):
    """BookRun 导出前置条件不满足。"""


class BookExportNotFoundError(NotFoundError, BookExportError):
    """BookRun 导出对象不存在。"""


def export_book_run_markdown(session: Session, book_run_id: int, *, workspace_id: int | None = None) -> Artifact:
    """导出 completed BookRun 的 Markdown 正文并登记到 artifacts。"""

    book_run = _completed_book_run(session, book_run_id)
    book = session.get(Book, book_run.book_id)
    if book is None:
        raise BookExportError("作品不存在，无法导出 BookRun。")
    _validate_book_run_workspace(book, workspace_id)
    scenes = _approved_scenes(session, book_run)
    lines = ["---", f"book_run_id: {book_run.id}", f"blueprint_id: {book_run.blueprint_id}", "---", "", f"# {book.title}", ""]
    for chapter, scene in scenes:
        body = _strip_redundant_title_line(str(scene.content), chapter.title)
        lines.extend([f"## 第 {chapter.ordinal} 章 {chapter.title}", "", body, ""])
    content = "\n".join(lines).strip() + "\n"
    content_bytes = content.encode("utf-8")

    # 尝试上传到 S3；失败或客户端不可用时回退到 memory:// + inline payload。
    s3_uri = upload_bytes(f"book-runs/{book_run_id}/book.md", content_bytes, "text/markdown")
    if s3_uri:
        storage_uri = s3_uri
        payload = {"uploaded_at": datetime.now(UTC).isoformat()}
    else:
        storage_uri = f"memory://book-runs/{book_run_id}/book.md"
        payload = {"content": content}

    return create_artifact(
        session,
        ArtifactCreate(
            workspace_id=book.workspace_id,
            book_id=book.id,
            artifact_type="book_export",
            lineage_key=f"book-run:{book_run.id}:markdown",
            name="book.md",
            storage_uri=storage_uri,
            mime_type="text/markdown",
            size_bytes=len(content_bytes),
            payload=payload,
        ),
    )


def export_book_run_audit_report(session: Session, book_run_id: int, *, workspace_id: int | None = None) -> Artifact:
    """导出 9A 最小审计 JSON，确保每章有生成、评审和批准索引。"""

    book_run = _completed_book_run(session, book_run_id)
    book = session.get(Book, book_run.book_id)
    if book is None:
        raise BookExportError("作品不存在，无法导出 BookRun 审计报告。")
    _validate_book_run_workspace(book, workspace_id)
    chapters = list(book_run.progress.get("completed_chapters", []))
    integration_metrics = _integration_metrics_projection(book_run.progress)
    quality_summary = _quality_summary(chapters)
    full_book_advisory_audit = _full_book_advisory_audit(session, book_run=book_run)
    quality_summary["full_book_advisory_status"] = full_book_advisory_audit["status"]
    if integration_metrics:
        quality_summary["integration_metrics"] = integration_metrics
    report = {
        "book_run_id": book_run.id,
        "blueprint_id": book_run.blueprint_id,
        "chapters": chapters,
        "quality_summary": quality_summary,
        "chapter_quality_scores": _chapter_quality_scores(chapters),
        "top_quality_issues": _top_quality_issues(chapters),
        "manual_review_recommendations": _manual_review_recommendations(chapters),
        "manual_read_gate": _manual_read_gate_projection(book_run.progress),
        "manual_read_review": _manual_read_review_projection(book_run.progress),
        "full_book_advisory_audit": full_book_advisory_audit,
        "skill_chain": derive_book_run_skill_chain(book_run.id, book_run.status, book_run.progress),
    }
    if integration_metrics:
        report["integration_metrics"] = integration_metrics
    for chapter in report["chapters"]:
        if not chapter.get("model_run_id") or not chapter.get("judge_report_id") or not chapter.get("approved_scene_id"):
            raise BookExportError("BookRun 审计证据不完整，无法导出 audit_report.json。")

    report_json = json.dumps(report, ensure_ascii=False, indent=2)
    report_bytes = report_json.encode("utf-8")

    # 尝试上传到 S3；失败时回退到 memory:// + inline payload。
    s3_uri = upload_bytes(f"book-runs/{book_run_id}/audit_report.json", report_bytes, "application/json")
    if s3_uri:
        storage_uri = s3_uri
        payload = {"uploaded_at": datetime.now(UTC).isoformat()}
    else:
        storage_uri = f"memory://book-runs/{book_run_id}/audit_report.json"
        payload = report

    return create_artifact(
        session,
        ArtifactCreate(
            workspace_id=book.workspace_id,
            book_id=book.id,
            artifact_type="book_audit_report",
            lineage_key=f"book-run:{book_run.id}:audit-report",
            name="audit_report.json",
            storage_uri=storage_uri,
            mime_type="application/json",
            size_bytes=len(report_bytes),
            payload=payload,
        ),
    )


def build_book_run_epub_package(session: Session, book_run_id: int, *, workspace_id: int | None = None) -> bytes:
    """生成 completed BookRun 的最小 EPUB 二进制包。"""

    book_run = _completed_book_run(session, book_run_id)
    book = session.get(Book, book_run.book_id)
    if book is None:
        raise BookExportError("作品不存在，无法导出 BookRun EPUB。")
    _validate_book_run_workspace(book, workspace_id)
    scenes = _approved_scenes(session, book_run)
    return _build_epub_bytes(book, scenes)


def export_book_run_epub(session: Session, book_run_id: int, *, workspace_id: int | None = None) -> Artifact:
    """导出 completed BookRun 的 EPUB 并登记到 artifacts。"""

    book_run = _completed_book_run(session, book_run_id)
    book = session.get(Book, book_run.book_id)
    if book is None:
        raise BookExportError("作品不存在，无法导出 BookRun EPUB。")
    _validate_book_run_workspace(book, workspace_id)
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

    # 尝试上传到 S3；失败时回退到 memory:// + inline payload。
    s3_uri = upload_bytes(f"book-runs/{book_run_id}/book.epub", content, "application/epub+zip")
    if s3_uri:
        storage_uri = s3_uri
        payload = {
            "uploaded_at": datetime.now(UTC).isoformat(),
            "format": "epub",
            "chapter_count": len({chapter.ordinal for chapter, _scene in scenes}),
        }
    else:
        storage_uri = f"memory://book-runs/{book_run.id}/book.epub"
        payload = {
            "format": "epub",
            "book_run_id": book_run.id,
            "blueprint_id": book_run.blueprint_id,
            "chapter_count": len({chapter.ordinal for chapter, _scene in scenes}),
            "manifest": chapter_manifest,
        }

    return create_artifact(
        session,
        ArtifactCreate(
            workspace_id=book.workspace_id,
            book_id=book.id,
            artifact_type="book_epub_export",
            lineage_key=f"book-run:{book_run.id}:epub",
            name="book.epub",
            storage_uri=storage_uri,
            mime_type="application/epub+zip",
            size_bytes=len(content),
            payload=payload,
        ),
    )


def _strip_redundant_title_line(content: str, chapter_title: str | None) -> str:
    """剥离模型在正文开头重复抄写的章标题行（如正文首行 `# 铜钟疑案 12`）。

    导出已统一加 `## 第 N 章 标题` 头，正文里再出现同名 ATX 标题是生成泄漏，会在成书/EPUB
    里重复显示。只剥离与章标题一致的首个标题行，不动原始正文与非标题首行。
    """

    text = (content or "").strip()
    title = " ".join((chapter_title or "").split())
    if not text or not title:
        return text
    lines = text.splitlines()
    idx = 0
    while idx < len(lines) and not lines[idx].strip():
        idx += 1
    if idx >= len(lines):
        return text
    first = lines[idx].strip()
    if first.startswith("#") and " ".join(first.lstrip("#").split()) == title:
        del lines[idx]
        return "\n".join(lines).strip()
    return text


def _completed_book_run(session: Session, book_run_id: int) -> BookRun:
    book_run = session.get(BookRun, book_run_id)
    if book_run is None:
        raise BookExportNotFoundError("BookRun 不存在，无法导出。")
    if book_run.status != "completed":
        raise BookExportError("BookRun 尚未完成，无法导出。")
    return book_run


def _validate_book_run_workspace(book: Book, workspace_id: int | None) -> None:
    if workspace_id is not None and book.workspace_id != workspace_id:
        raise ArtifactForbiddenError("BookRun 工作区不匹配，禁止导出。")


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

    content = _strip_redundant_title_line(str(scene.content), chapter.title)
    paragraphs = [part.strip() for part in content.splitlines() if part.strip()]
    body = "\n".join(f"  <p>{escape(paragraph)}</p>" for paragraph in paragraphs or [content])
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


def _chapter_quality_scores(chapters: list[dict[str, object]]) -> list[dict[str, object]]:
    return [
        {
            "chapter_index": chapter.get("chapter_index"),
            "quality_score": chapter.get("quality_score"),
        }
        for chapter in chapters
        if isinstance(chapter, dict) and chapter.get("quality_score") is not None
    ]


def _top_quality_issues(chapters: list[dict[str, object]]) -> list[dict[str, object]]:
    issues: list[dict[str, object]] = []
    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue
        for issue in chapter.get("quality_issues", []) if isinstance(chapter.get("quality_issues"), list) else []:
            if isinstance(issue, dict):
                issues.append({"chapter_index": chapter.get("chapter_index"), **issue})
    return issues[:10]


def _manual_review_recommendations(chapters: list[dict[str, object]]) -> list[str]:
    recommendations: list[str] = []
    for issue in _top_quality_issues(chapters):
        if str(issue.get("severity")) in {"high", "critical"}:
            chapter_index = issue.get("chapter_index")
            dimension = _quality_dimension_label(str(issue.get("dimension") or "narrative_quality"))
            summary = str(issue.get("summary") or issue.get("message") or "需要人工复核。").strip()
            recommendations.append(f"第 {chapter_index} 章存在高严重度质量问题（{dimension}）：{summary}")
    return recommendations


def _quality_dimension_label(dimension: str) -> str:
    labels = {
        "system_reliability": "系统可靠性",
        "narrative_quality": "叙事质量",
        "character_consistency": "人物一致性",
        "world_consistency": "世界观一致性",
        "timeline_consistency": "时间线一致性",
        "style_consistency": "文风一致性",
    }
    return labels.get(dimension, dimension)


def _manual_read_gate_projection(progress: dict[str, object]) -> dict[str, object] | None:
    gate = progress.get("manual_read_gate") if isinstance(progress, dict) else None
    return dict(gate) if isinstance(gate, dict) else None


def _manual_read_review_projection(progress: dict[str, object]) -> dict[str, object] | None:
    review = progress.get("manual_read_review") if isinstance(progress, dict) else None
    if not isinstance(review, dict):
        return None
    raw_scores = review.get("dimension_scores")
    dimension_scores: list[dict[str, object]] = []
    if isinstance(raw_scores, list):
        for item in raw_scores:
            if not isinstance(item, dict):
                continue
            dimension = item.get("dimension")
            score = item.get("score")
            if not isinstance(dimension, str) or not isinstance(score, int | float):
                continue
            entry: dict[str, object] = {
                "dimension": dimension,
                "dimension_label": _quality_dimension_label(dimension),
                "score": score,
            }
            comment = item.get("comment")
            if isinstance(comment, str) and comment.strip():
                entry["comment"] = comment
            dimension_scores.append(entry)
    projected: dict[str, object] = {"dimension_scores": dimension_scores}
    for key in ("status", "reviewer", "conclusion"):
        value = review.get(key)
        if isinstance(value, str) and value.strip():
            projected[key] = value
    for key in ("reviewed_chapter_count", "word_count"):
        value = review.get(key)
        if isinstance(value, int):
            projected[key] = value
    overall = review.get("overall_score")
    if isinstance(overall, int | float):
        projected["overall_score"] = overall
    blind = review.get("blind")
    if isinstance(blind, bool):
        projected["blind"] = blind
    return projected


def _integration_metrics_projection(progress: dict[str, object]) -> dict[str, object]:
    metrics = progress.get("integration_metrics") if isinstance(progress, dict) else None
    if not isinstance(metrics, dict):
        return {}
    allowed = {
        "context_cache_hit_rate",
        "memory_recall_budget_used",
        "arc_completion_rate",
        "db_query_count_per_chapter",
        "chapter_generation_time_p50",
        "concurrent_chapter_utilization",
        "chapter_correction_count",
    }
    projected = {key: value for key, value in metrics.items() if key in allowed and isinstance(value, int | float)}
    for key in ("dependency_mode", "metric_scope", "memory_recall_budget_scope"):
        value = metrics.get(key)
        if isinstance(value, str) and value.strip():
            projected[key] = value
    return projected


def _quality_summary(chapters: list[dict[str, object]]) -> dict[str, object]:
    scores = [float(chapter["quality_score"]) for chapter in chapters if isinstance(chapter, dict) and isinstance(chapter.get("quality_score"), int | float)]
    issues = _top_quality_issues(chapters)
    return {
        "average_score": round(sum(scores) / len(scores), 2) if scores else None,
        "scored_chapter_count": len(scores),
        "issue_count": len(issues),
        "status": "needs_review" if _manual_review_recommendations(chapters) else "ok",
    }


def _full_book_advisory_audit(session: Session, *, book_run: BookRun) -> dict[str, object]:
    """整书级终检咨询信号；不作为导出硬门禁。"""

    try:
        scenes = _approved_scenes(session, book_run)
        checks = [
            _full_book_chapter_count_check(book_run, scenes),
            _full_book_forbidden_terms_check(scenes),
            _full_book_repeated_openings_check(scenes),
            _full_book_story_state_open_items_check(session, book_run),
            _full_book_final_chapter_signal_check(book_run, scenes),
        ]
    except Exception as exc:  # noqa: BLE001 - audit 不应阻断导出，但必须留下 error 而非伪 clean。
        return {
            "status": "error",
            "mode": "advisory",
            "hard_gate": False,
            "error": str(exc)[:500],
            "checks": [],
        }
    status = "needs_review" if any(check["status"] in {"needs_review", "error"} for check in checks) else "pass"
    if status == "pass" and any(check["status"] == "unavailable" for check in checks):
        status = "partial"
    return {
        "status": status,
        "mode": "advisory",
        "hard_gate": False,
        "checks": checks,
    }


def _full_book_chapter_count_check(
    book_run: BookRun,
    scenes: list[tuple[Chapter, Scene]],
) -> dict[str, object]:
    chapter_indexes = sorted({chapter.ordinal for chapter, _scene in scenes})
    expected = int(book_run.total_chapters or 0)
    status = "pass" if expected > 0 and len(chapter_indexes) == expected else "needs_review"
    return {
        "name": "chapter_count_integrity",
        "status": status,
        "expected_chapter_count": expected,
        "actual_chapter_count": len(chapter_indexes),
        "chapter_indexes": chapter_indexes,
    }


def _full_book_forbidden_terms_check(scenes: list[tuple[Chapter, Scene]]) -> dict[str, object]:
    findings: list[dict[str, object]] = []
    for chapter, scene in scenes:
        content = scene.content or ""
        terms = [term for term in FORBIDDEN_DRAFT_TERMS if term in content]
        if terms:
            findings.append({"chapter_index": chapter.ordinal, "terms": terms})
    return {
        "name": "forbidden_draft_terms",
        "status": "needs_review" if findings else "pass",
        "findings": findings,
    }


def _full_book_repeated_openings_check(scenes: list[tuple[Chapter, Scene]]) -> dict[str, object]:
    buckets: dict[str, list[int]] = {}
    for chapter, scene in scenes:
        opening = _normalized_opening(scene.content or "")
        if not opening:
            continue
        buckets.setdefault(opening, []).append(chapter.ordinal)
    repeated = [
        {"opening": opening, "chapter_indexes": indexes}
        for opening, indexes in sorted(buckets.items())
        if len(indexes) >= 3
    ]
    return {
        "name": "repeated_openings",
        "status": "needs_review" if repeated else "pass",
        "findings": repeated,
    }


def _full_book_story_state_open_items_check(session: Session, book_run: BookRun) -> dict[str, object]:
    event_count = int(
        session.scalar(
            select(func.count())
            .select_from(StoryStateEvent)
            .where(StoryStateEvent.book_id == book_run.book_id, StoryStateEvent.book_run_id == book_run.id)
        )
        or 0
    )
    if event_count == 0:
        return {
            "name": "story_state_open_items",
            "status": "unavailable",
            "reason": "story_state_events_not_found",
            "findings": [],
        }
    ledgers = session.scalars(
        select(StoryStateLedger).where(
            StoryStateLedger.book_id == book_run.book_id,
            StoryStateLedger.book_run_id == book_run.id,
        )
    ).all()
    findings = [
        {
            "entity_kind": ledger.entity_kind,
            "entity_id": ledger.entity_id,
            "canonical_name": ledger.canonical_name,
            "state": ledger.state,
        }
        for ledger in ledgers
        if _story_state_ledger_is_open(ledger)
    ]
    return {
        "name": "story_state_open_items",
        "status": "needs_review" if findings else "pass",
        "findings": findings[:20],
    }


def _full_book_final_chapter_signal_check(
    book_run: BookRun,
    scenes: list[tuple[Chapter, Scene]],
) -> dict[str, object]:
    if not scenes:
        return {"name": "final_chapter_resolution_signal", "status": "unavailable", "reason": "no_approved_scenes"}
    last_chapter, last_scene = max(scenes, key=lambda item: item[0].ordinal)
    if last_chapter.ordinal < int(book_run.total_chapters or 0):
        return {
            "name": "final_chapter_resolution_signal",
            "status": "unavailable",
            "reason": "final_chapter_missing",
            "last_chapter_index": last_chapter.ordinal,
        }
    content = last_scene.content or ""
    signals = ("真相", "解决", "收束", "结束", "答案", "回收", "兑现")
    matched = [signal for signal in signals if _has_positive_resolution_signal(content, signal)]
    return {
        "name": "final_chapter_resolution_signal",
        "status": "pass" if matched else "needs_review",
        "matched_signals": matched,
        "chapter_index": last_chapter.ordinal,
    }


def _normalized_opening(content: str, *, max_chars: int = 40) -> str:
    first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
    normalized = "".join(first_line.split())
    return normalized[:max_chars]


def _has_positive_resolution_signal(content: str, signal: str) -> bool:
    if signal not in content:
        return False
    negated_markers = (f"没{signal}", f"未{signal}", f"没有{signal}", f"尚未{signal}", f"仍未{signal}")
    return not any(marker in content for marker in negated_markers)


def _story_state_ledger_is_open(ledger: StoryStateLedger) -> bool:
    state = ledger.state if isinstance(ledger.state, dict) else {}
    phase = str(state.get("phase") or state.get("status") or "").strip().lower()
    if ledger.entity_kind == "foreshadow":
        return phase not in {"payoff", "resolved", "closed", "已收", "回收"}
    if ledger.entity_kind in {"conflict", "countdown", "oath"}:
        return phase not in {"resolved", "completed", "cancelled", "broken", "已完成", "已解决", "取消", "违背"}
    return False
