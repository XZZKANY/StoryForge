from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report, export_book_run_markdown


def test_book_run_markdown_and_audit_report_exports_artifacts(session_factory: sessionmaker[Session]) -> None:
    """完成的 BookRun 应导出 book.md 和可追溯 audit_report.json。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)

        markdown_artifact = export_book_run_markdown(session, book_run_id)
        audit_artifact = export_book_run_audit_report(session, book_run_id)

        assert markdown_artifact.name == "book.md"
        assert markdown_artifact.mime_type == "text/markdown"
        assert "# 雾港航线" in markdown_artifact.payload["content"]
        assert "## 第 1 章 雾港航线 1" in markdown_artifact.payload["content"]
        assert "第一章正文" in markdown_artifact.payload["content"]

        assert audit_artifact.name == "audit_report.json"
        assert audit_artifact.mime_type == "application/json"
        report = audit_artifact.payload
        assert report["book_run_id"] == book_run_id
        assert len(report["chapters"]) == 3
        assert report["chapters"][0]["model_run_id"] == 11
        assert report["chapters"][0]["judge_report_id"] == 12
        assert report["chapters"][0]["approved_scene_id"] > 0
        assert "quality_summary" in report
        assert "chapter_quality_scores" in report
        assert "top_quality_issues" in report
        assert "manual_review_recommendations" in report
        assert report["skill_chain"]["skill_chain_version"] == "bookrun-default-v1"
        assert report["skill_chain"]["chapters"][0]["skills"][0]["skill_name"] == "generate"
        assert report["skill_chain"]["chapters"][0]["skills"][1]["skill_name"] == "judge"
        assert report["skill_chain"]["chapters"][0]["skills"][2]["skill_name"] == "approve"


def test_book_run_export_endpoints_return_artifacts(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 导出 API 应返回 book.md 与 audit_report.json 制品。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)

    markdown_response = client.post(f"/api/book-runs/{book_run_id}/exports/markdown")
    audit_response = client.post(f"/api/book-runs/{book_run_id}/exports/audit-report")

    assert markdown_response.status_code == 200, markdown_response.text
    assert markdown_response.json()["name"] == "book.md"
    assert markdown_response.json()["mime_type"] == "text/markdown"
    assert audit_response.status_code == 200, audit_response.text
    assert audit_response.json()["name"] == "audit_report.json"
    assert audit_response.json()["payload"]["book_run_id"] == book_run_id


def _seed_completed_book_run(session: Session) -> int:
    book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。")
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
                "quality_score": 88 + index,
                "quality_issues": [{"dimension": "??", "severity": "?", "message": "????"}] if index == 1 else [],
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



def test_book_run_audit_report_prefers_recorded_skill_chain(session_factory: sessionmaker[Session]) -> None:
    """audit_report.json 有真实 skill_runs 时应优先输出记录链路。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)
        book_run = session.get(BookRun, book_run_id)
        assert book_run is not None
        progress = dict(book_run.progress)
        completed = list(progress["completed_chapters"])
        first = dict(completed[0])
        first["skill_runs"] = [
            {"skill_name": "generate", "status": "generated", "output_refs": {"model_run_id": 11}},
            {"skill_name": "judge", "status": "pass", "output_refs": {"judge_report_id": 12}},
            {"skill_name": "approve", "status": "approved", "output_refs": {"approved_scene_id": first["approved_scene_id"]}},
        ]
        completed[0] = first
        progress["completed_chapters"] = completed
        book_run.progress = progress
        session.commit()

        audit_artifact = export_book_run_audit_report(session, book_run_id)

        skills = audit_artifact.payload["skill_chain"]["chapters"][0]["skills"]
        assert [skill["skill_name"] for skill in skills[:3]] == ["generate", "judge", "approve"]
        assert skills[0]["model_run_id"] == 11


def test_book_run_audit_report_outputs_empty_skill_chain_for_empty_progress(session_factory: sessionmaker[Session]) -> None:
    """旧 progress 缺少章节审计数据时，skill_chain 应空数组退化。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)
        book_run = session.get(BookRun, book_run_id)
        assert book_run is not None
        book_run.progress = {"completed_chapters": []}
        session.commit()

        audit_artifact = export_book_run_audit_report(session, book_run_id)

        assert audit_artifact.payload["chapters"] == []
        assert audit_artifact.payload["skill_chain"] == {
            "skill_chain_version": "bookrun-default-v1",
            "chapters": [],
            "book_level_skills": [],
            "book_status_projection": {"status": "completed", "pause_reason": None},
        }
