from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.books.models import Book, Chapter
from app.domains.jobs.models import JobRun
from app.domains.prompt_packs.models import PromptPack
from app.domains.workspaces.models import Workspace


@pytest.fixture()
def run_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="Phase4 团队", slug="phase4-run-team", status="active", seat_limit=3)
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。", workspace_id=None)
        session.add_all([workspace, book])
        session.flush()
        job = JobRun(book_id=book.id, job_type="generation_runtime", status="running", progress={})
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="林岚追查信号。",
            tone="克制悬疑",
            target_word_count=3000,
            target_chapter_count=1,
            chapter_word_count_min=1000,
            chapter_word_count_max=1500,
            status="locked",
            version=1,
            metadata_={},
        )
        session.add(blueprint)
        session.flush()
        chapter = Chapter(book_id=book.id, blueprint_id=blueprint.id, ordinal=1, title="旧港", status="planned")
        session.add(chapter)
        session.flush()
        prompt_pack = PromptPack(
            workspace_id=workspace.id,
            book_id=book.id,
            pack_type="draft_writer",
            lineage_key="prompt-pack-run",
            name="运行测试包",
            status="active",
            payload={"system": "保持克制"},
            version=1,
        )
        session.add_all([job, prompt_pack])
        session.commit()
        return {
            "workspace_id": workspace.id,
            "book_id": book.id,
            "chapter_id": chapter.id,
            "job_run_id": job.id,
            "prompt_pack_id": prompt_pack.id,
        }


def test_record_failed_runtime_model_run_preserves_error_for_recovery(
    session_factory: sessionmaker[Session], run_scope: dict[str, int]
) -> None:
    """运行时 provider 失败也应写入 ModelRun 真表，保留错误摘要供恢复排查。"""

    from app.domains.model_runs.service import list_model_runs, record_failed_runtime_model_run

    with session_factory() as session:
        failed_run = record_failed_runtime_model_run(
            session,
            job_run_id=run_scope["job_run_id"],
            provider_name="mock-provider",
            model_name="storyforge-writer",
            capability="llm",
            input_summary="远航舰队寻找新家园。::林岚争取维修窗口。",
            error_message="provider timeout",
            workspace_id=run_scope["workspace_id"],
            book_id=run_scope["book_id"],
            prompt_pack_id=run_scope["prompt_pack_id"],
            payload={"thread_id": "phase5-runtime-failure", "error_code": "provider_execution_failed"},
        )
        listed = list_model_runs(session, job_run_id=run_scope["job_run_id"])

    assert failed_run.status == "failed"
    assert failed_run.token_usage == 0
    assert failed_run.error_message == "provider timeout"
    assert failed_run.payload["error_code"] == "provider_execution_failed"
    assert [item.id for item in listed] == [failed_run.id]
