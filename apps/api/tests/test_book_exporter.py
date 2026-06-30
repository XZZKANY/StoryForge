from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.artifacts.models import Artifact
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.exports.book_markdown_exporter import (
    export_book_run_audit_report,
    export_book_run_epub,
    export_book_run_markdown,
)
from app.domains.story_state.models import StoryStateEvent, StoryStateLedger
from app.domains.workspaces.models import Workspace


def test_book_run_markdown_and_audit_report_exports_artifacts(session_factory: sessionmaker[Session]) -> None:
    """完成的 BookRun 应导出 book.md 和可追溯 audit_report.json。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)

        markdown_artifact = export_book_run_markdown(session, book_run_id)
        audit_artifact = export_book_run_audit_report(session, book_run_id)
        epub_artifact = export_book_run_epub(session, book_run_id)

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
        assert report["full_book_advisory_audit"]["mode"] == "advisory"
        assert report["full_book_advisory_audit"]["hard_gate"] is False
        assert report["quality_summary"]["full_book_advisory_status"] == report["full_book_advisory_audit"]["status"]
        assert _audit_check(report, "chapter_count_integrity")["status"] == "pass"
        assert _audit_check(report, "story_state_open_items")["status"] == "unavailable"
        assert "chapter_quality_scores" in report
        assert "top_quality_issues" in report
        assert "manual_review_recommendations" in report
        assert report["manual_review_recommendations"] == ["第 1 章存在高严重度质量问题（系统可靠性）：需人工复核。"]
        assert "??" not in str(report["manual_review_recommendations"])
        assert report["manual_read_gate"] == {
            "status": "passed",
            "reviewer": "人工通读验收",
            "reviewed_chapter_count": 10,
            "word_count": 36000,
            "conclusion": "通过人工通读门禁。",
        }
        assert report["manual_read_review"] == {
            "status": "passed",
            "reviewer": "人工盲评 A",
            "reviewed_chapter_count": 10,
            "word_count": 36000,
            "blind": True,
            "overall_score": 4.5,
            "conclusion": "通过人工盲评门禁。",
            "dimension_scores": [
                {
                    "dimension": "narrative_quality",
                    "dimension_label": "叙事质量",
                    "score": 4,
                    "comment": "推进顺畅。",
                },
                {
                    "dimension": "character_consistency",
                    "dimension_label": "人物一致性",
                    "score": 5,
                },
            ],
        }
        assert report["integration_metrics"] == {
            "context_cache_hit_rate": 0.96,
            "memory_recall_budget_used": 7999,
            "arc_completion_rate": 0.71,
            "db_query_count_per_chapter": 3,
            "chapter_generation_time_p50": 19,
            "concurrent_chapter_utilization": 0.61,
            "chapter_correction_count": 3,
            "dependency_mode": "prior_chapter_commit",
            "metric_scope": "workflow_book_loop_parallel_runtime_overlap",
        }
        assert report["quality_summary"]["integration_metrics"] == report["integration_metrics"]
        assert report["skill_chain"]["schema_version"] == "bookrun_skill_projection.v2"
        assert report["skill_chain"]["book_run_id"] == book_run_id
        assert report["skill_chain"]["summary"]["completed_chapter_count"] == 3
        assert report["skill_chain"]["summary"]["evidence_basis"] == "reconstructed"
        assert report["skill_chain"]["summary"]["recorded_event_count"] == 0
        assert report["skill_chain"]["summary"]["reconstructed_event_count"] == len(report["skill_chain"]["events"])
        assert [event["skill_name"] for event in report["skill_chain"]["events"][:5]] == [
            "generate",
            "judge",
            "approve",
            "memory_extract",
            "generate",
        ]
        assert report["skill_chain"]["events"][-1]["skill_name"] == "export"

        assert epub_artifact.name == "book.epub"
        assert epub_artifact.mime_type == "application/epub+zip"
        assert epub_artifact.payload["book_run_id"] == book_run_id


def test_full_book_advisory_audit_reports_needs_review_without_blocking_export(
    session_factory: sessionmaker[Session],
) -> None:
    """整书终检发现咨询式风险时应留痕，但不阻断 audit_report 导出。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)
        book_run = session.get(BookRun, book_run_id)
        assert book_run is not None
        repeated_opening = "同一句开头"
        for scene in _book_run_scenes(session, book_run):
            scene.content = f"{repeated_opening}\nworkflow 从码头暗门漏出，调查还没结束。"
        session.add(
            StoryStateEvent(
                book_id=book_run.book_id,
                book_run_id=book_run.id,
                chapter_index=3,
                seq=1,
                change_type="upsert",
                entity_kind="foreshadow",
                entity_id="fog-lighthouse-signal",
                payload={"phase": "planted"},
                grounding={"advisory_fixture": True},
            )
        )
        session.add(
            StoryStateLedger(
                book_id=book_run.book_id,
                book_run_id=book_run.id,
                entity_kind="foreshadow",
                entity_id="fog-lighthouse-signal",
                canonical_name="雾港灯塔信号",
                aliases=[],
                state={"phase": "planted"},
                last_chapter=3,
            )
        )
        session.commit()

        audit_artifact = export_book_run_audit_report(session, book_run_id)

        report = audit_artifact.payload
        advisory = report["full_book_advisory_audit"]
        assert audit_artifact.name == "audit_report.json"
        assert advisory["status"] == "needs_review"
        assert advisory["hard_gate"] is False
        assert report["quality_summary"]["full_book_advisory_status"] == "needs_review"
        assert _audit_check(report, "forbidden_draft_terms")["findings"][0]["terms"] == ["workflow"]
        assert _audit_check(report, "repeated_openings")["findings"] == [
            {"opening": repeated_opening, "chapter_indexes": [1, 2, 3]}
        ]
        assert _audit_check(report, "story_state_open_items")["findings"] == [
            {
                "entity_kind": "foreshadow",
                "entity_id": "fog-lighthouse-signal",
                "canonical_name": "雾港灯塔信号",
                "state": {"phase": "planted"},
            }
        ]
        assert _audit_check(report, "final_chapter_resolution_signal")["status"] == "needs_review"


def test_full_book_advisory_audit_marks_story_state_unavailable_without_fake_pass(
    session_factory: sessionmaker[Session],
) -> None:
    """没有 StoryState 事件时终检应标 unavailable，避免伪装成干净通过。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(session)
        book_run = session.get(BookRun, book_run_id)
        assert book_run is not None
        _book_run_scenes(session, book_run)[-1].content = "第三章正文。灯塔真相解决，答案回收。"
        session.commit()

        audit_artifact = export_book_run_audit_report(session, book_run_id)

        report = audit_artifact.payload
        story_state_check = _audit_check(report, "story_state_open_items")
        assert story_state_check["status"] == "unavailable"
        assert story_state_check["reason"] == "story_state_events_not_found"
        assert report["full_book_advisory_audit"]["status"] == "partial"
        assert report["quality_summary"]["full_book_advisory_status"] == "partial"


def test_audit_report_skill_chain_prefers_recorded_skill_runs_without_full_payload(
    session_factory: sessionmaker[Session],
) -> None:
    """审计报告技能链应优先展示真实运行记录，且不复制完整提示词或正文。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run(
            session,
            skill_runs=[
                {
                    "skill_name": "generate",
                    "skill_version": "1.0.0",
                    "status": "generated",
                    "input_refs": {"compiled_context_id": "ctx-1"},
                    "output_refs": {"model_run_id": 11, "draft_hash": "sha256:draft"},
                    "budget": {"tokens_used": 120},
                    "prompt": "不应进入审计报告的完整提示词。",
                },
                {
                    "skill_name": "judge",
                    "skill_version": "1.0.0",
                    "status": "pass",
                    "output_refs": {"judge_report_id": 12},
                    "final_draft": "不应进入审计报告的完整正文。",
                },
                {
                    "skill_name": "approve",
                    "skill_version": "1.0.0",
                    "status": "approved",
                    "output_refs": {"approved_scene_id": 1},
                },
            ],
        )

        audit_artifact = export_book_run_audit_report(session, book_run_id)

        skill_chain = audit_artifact.payload["skill_chain"]
        assert [event["skill_name"] for event in skill_chain["events"][:3]] == ["generate", "judge", "approve"]
        assert skill_chain["summary"]["evidence_basis"] == "mixed"
        assert skill_chain["summary"]["recorded_event_count"] == 3
        assert skill_chain["summary"]["reconstructed_event_count"] == len(skill_chain["events"]) - 3
        assert skill_chain["events"][0]["recorded"] is True
        assert skill_chain["events"][0]["provenance"] == "recorded_skill_run"
        assert skill_chain["events"][-1]["recorded"] is False
        assert skill_chain["events"][-1]["provenance"] == "reconstructed_from_progress"
        assert skill_chain["events"][0]["input_refs"] == {"compiled_context_id": "ctx-1"}
        assert skill_chain["events"][0]["output_refs"] == {"model_run_id": 11, "draft_hash": "sha256:draft"}
        assert skill_chain["events"][0]["metadata"] == {"budget": {"tokens_used": 120}}
        assert skill_chain["events"][1]["output_refs"] == {"judge_report_id": 12}
        rendered = str(skill_chain)
        assert "不应进入审计报告的完整提示词" not in rendered
        assert "不应进入审计报告的完整正文" not in rendered


def test_book_run_export_endpoints_return_artifacts(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 导出 API 应返回 book.md 与 audit_report.json 制品。"""

    with session_factory() as session:
        book_run_id, workspace_id = _seed_completed_book_run_with_workspace(session)

    markdown_response = client.post(
        f"/api/book-runs/{book_run_id}/exports/markdown",
        params={"workspace_id": workspace_id},
    )
    epub_response = client.post(
        f"/api/book-runs/{book_run_id}/exports/epub",
        params={"workspace_id": workspace_id},
    )
    audit_response = client.post(
        f"/api/book-runs/{book_run_id}/exports/audit-report",
        params={"workspace_id": workspace_id},
    )

    assert markdown_response.status_code == 200, markdown_response.text
    assert markdown_response.json()["name"] == "book.md"
    assert markdown_response.json()["mime_type"] == "text/markdown"
    assert epub_response.status_code == 200, epub_response.text
    assert epub_response.json()["name"] == "book.epub"
    assert epub_response.json()["mime_type"] == "application/epub+zip"
    assert audit_response.status_code == 200, audit_response.text
    assert audit_response.json()["name"] == "audit_report.json"
    assert audit_response.json()["payload"]["book_run_id"] == book_run_id


def test_book_run_export_endpoints_require_workspace_scope(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 导出 API 必须显式传入匹配的 workspace_id，避免跨工作区旁路导出。"""

    with session_factory() as session:
        book_run_id, workspace_id = _seed_completed_book_run_with_workspace(session)
        other_workspace = Workspace(title="其他工作区", slug="other-bookrun-export-scope", status="active")
        session.add(other_workspace)
        session.commit()
        other_workspace_id = other_workspace.id

    missing_scope = client.post(f"/api/book-runs/{book_run_id}/exports/markdown")
    wrong_scope = client.post(
        f"/api/book-runs/{book_run_id}/exports/markdown",
        params={"workspace_id": other_workspace_id},
    )
    correct_scope = client.post(
        f"/api/book-runs/{book_run_id}/exports/markdown",
        params={"workspace_id": workspace_id},
    )
    missing_book_run = client.post(
        "/api/book-runs/999999/exports/markdown",
        params={"workspace_id": workspace_id},
    )

    assert missing_scope.status_code == 422
    assert wrong_scope.status_code == 403
    assert correct_scope.status_code == 200
    assert missing_book_run.status_code == 404


def test_book_run_export_endpoints_reject_non_completed_without_artifacts(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 未完成时三类导出 API 都应拒绝，且不创建制品。"""

    with session_factory() as session:
        book_run_id, workspace_id = _seed_completed_book_run_with_workspace(session, status="running")
        artifact_count_before = session.query(Artifact).count()

    for path in ["markdown", "epub", "audit-report"]:
        response = client.post(
            f"/api/book-runs/{book_run_id}/exports/{path}",
            params={"workspace_id": workspace_id},
        )
        assert response.status_code == 400, response.text
        assert "BookRun 尚未完成" in response.json()["detail"]

    with session_factory() as session:
        assert session.query(Artifact).count() == artifact_count_before


def _seed_completed_book_run(
    session: Session,
    skill_runs: list[dict[str, object]] | None = None,
    status: str = "completed",
    workspace_id: int | None = None,
) -> int:
    book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。", workspace_id=workspace_id)
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
        chapter_progress = {
            "chapter_index": index,
            "model_run_id": index * 10 + 1,
            "judge_report_id": index * 10 + 2,
            "repair_patch_id": None,
            "approved_scene_id": scene.id,
            "quality_score": 88 + index,
            "quality_issues": [
                {
                    "dimension": "system_reliability",
                    "severity": "high",
                    "summary": "需人工复核。",
                }
            ]
            if index == 1
            else [],
        }
        if index == 1 and skill_runs is not None:
            normalized_runs = []
            for run in skill_runs:
                normalized_run = dict(run)
                if normalized_run.get("skill_name") == "approve":
                    normalized_run["output_refs"] = {"approved_scene_id": scene.id}
                normalized_runs.append(normalized_run)
            chapter_progress["skill_runs"] = normalized_runs
        completed.append(chapter_progress)
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status=status,
        current_chapter_index=3,
        total_chapters=3,
        progress={
            "completed_chapters": completed,
            "manual_read_gate": {
                "status": "passed",
                "reviewer": "人工通读验收",
                "reviewed_chapter_count": 10,
                "word_count": 36000,
                "conclusion": "通过人工通读门禁。",
            },
            "manual_read_review": {
                "status": "passed",
                "reviewer": "人工盲评 A",
                "reviewed_chapter_count": 10,
                "word_count": 36000,
                "blind": True,
                "overall_score": 4.5,
                "dimension_scores": [
                    {"dimension": "narrative_quality", "score": 4, "comment": "推进顺畅。"},
                    {"dimension": "character_consistency", "score": 5},
                ],
                "conclusion": "通过人工盲评门禁。",
            },
            "integration_metrics": {
                "context_cache_hit_rate": 0.96,
                "memory_recall_budget_used": 7999,
                "arc_completion_rate": 0.71,
                "db_query_count_per_chapter": 3,
                "chapter_generation_time_p50": 19,
                "concurrent_chapter_utilization": 0.61,
                "chapter_correction_count": 3,
                "dependency_mode": "prior_chapter_commit",
                "metric_scope": "workflow_book_loop_parallel_runtime_overlap",
            },
        },
    )
    session.add(book_run)
    session.commit()
    return book_run.id


def _seed_completed_book_run_with_workspace(
    session: Session,
    skill_runs: list[dict[str, object]] | None = None,
    status: str = "completed",
) -> tuple[int, int]:
    workspace = Workspace(title="BookRun 导出工作区", slug="bookrun-export-scope", status="active")
    session.add(workspace)
    session.flush()
    book_run_id = _seed_completed_book_run(session, skill_runs=skill_runs, status=status, workspace_id=workspace.id)
    return book_run_id, workspace.id


def _book_run_scenes(session: Session, book_run: BookRun) -> list[Scene]:
    return (
        session.query(Scene)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .filter(Chapter.book_id == book_run.book_id)
        .order_by(Chapter.ordinal)
        .all()
    )


def _audit_check(report: dict[str, object], name: str) -> dict[str, object]:
    advisory = report["full_book_advisory_audit"]
    assert isinstance(advisory, dict)
    checks = advisory["checks"]
    assert isinstance(checks, list)
    for check in checks:
        assert isinstance(check, dict)
        if check.get("name") == name:
            return check
    raise AssertionError(f"missing full-book advisory check: {name}")
