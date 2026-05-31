from __future__ import annotations

from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report


def test_audit_report_marks_adapter_skill_runs_as_recorded(session_factory: sessionmaker[Session]) -> None:
    """adapter 写入的 skill_runs 应在 audit_report 中显示为 recorded。"""

    with session_factory() as session:
        book_run_id = _seed_completed_book_run_with_skill_runs(session)
        artifact = export_book_run_audit_report(session, book_run_id)

    skill_chain = artifact.payload["skill_chain"]
    assert skill_chain["summary"]["recorded_event_count"] == 4
    assert skill_chain["summary"]["reconstructed_event_count"] == 1
    assert skill_chain["summary"]["evidence_basis"] == "mixed"
    assert [event["provenance"] for event in skill_chain["events"][:4]] == [
        "recorded_skill_run",
        "recorded_skill_run",
        "recorded_skill_run",
        "recorded_skill_run",
    ]
    assert skill_chain["events"][0]["recorded"] is True
    assert skill_chain["events"][-1]["skill_name"] == "export"
    assert skill_chain["events"][-1]["recorded"] is False
    assert "完整正文" not in str(skill_chain)
    assert "完整提示词" not in str(skill_chain)


def _seed_completed_book_run_with_skill_runs(session: Session) -> int:
    book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。")
    session.add(book)
    session.flush()
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="林岚在雾港追查失真的灯塔信号。",
        tone="克制悬疑",
        target_word_count=4500,
        target_chapter_count=1,
        chapter_word_count_min=1000,
        chapter_word_count_max=1800,
        status="locked",
        version=2,
        metadata_={},
    )
    session.add(blueprint)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="雾港航线 1", status="approved")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="第 1 章场景", status="approved", content="第一章正文")
    session.add(scene)
    session.flush()
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="completed",
        current_chapter_index=1,
        total_chapters=1,
        progress={
            "completed_chapters": [
                {
                    "chapter_index": 1,
                    "status": "approved",
                    "model_run_id": 501,
                    "judge_report_id": 600,
                    "repair_patch_id": None,
                    "approved_scene_id": scene.id,
                    "skill_runs": [
                        {
                            "skill_name": "generate",
                            "skill_version": "1.0.0",
                            "status": "generated",
                            "book_id": book.id,
                            "chapter_index": 1,
                            "input_refs": {"compiled_context_id": "ctx-1"},
                            "output_refs": {"model_run_id": 501, "draft_hash": "sha256:abc"},
                            "budget": {},
                            "error_summary": None,
                        },
                        {
                            "skill_name": "judge",
                            "skill_version": "1.0.0",
                            "status": "pass",
                            "book_id": None,
                            "chapter_index": None,
                            "input_refs": {"attempt": 0},
                            "output_refs": {"judge_report_id": 600},
                            "budget": {},
                            "error_summary": None,
                        },
                        {
                            "skill_name": "approve",
                            "skill_version": "1.0.0",
                            "status": "approved",
                            "book_id": book.id,
                            "chapter_index": 1,
                            "input_refs": {"source_model_run_id": 501, "judge_report_id": 600},
                            "output_refs": {"approved_scene_id": scene.id},
                            "budget": {},
                            "error_summary": None,
                        },
                        {
                            "skill_name": "memory_extract",
                            "skill_version": "1.0.0",
                            "status": "memory_extract_skipped",
                            "book_id": book.id,
                            "chapter_index": 1,
                            "input_refs": {"approved_scene_id": scene.id},
                            "output_refs": {"memory_atom_ids": []},
                            "budget": {},
                            "error_summary": None,
                        },
                    ],
                }
            ],
            "budget": {"tokens_used": 0, "elapsed_time_sec": 0, "estimated_cost": 0.0},
        },
    )
    session.add(book_run)
    session.commit()
    return book_run.id
