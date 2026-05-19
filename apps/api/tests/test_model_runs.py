from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book
from app.domains.jobs.models import JobRun
from app.domains.prompt_packs.models import PromptPack
from app.domains.workspaces.models import Workspace
from app.main import app

import pytest


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
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
def run_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        workspace = Workspace(title="Phase4 团队", slug="phase4-run-team", status="active", seat_limit=3)
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。", workspace_id=None)
        session.add_all([workspace, book])
        session.flush()
        job = JobRun(book_id=book.id, job_type="generation_runtime", status="running", progress={})
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
        return {"workspace_id": workspace.id, "book_id": book.id, "job_run_id": job.id, "prompt_pack_id": prompt_pack.id}


def test_model_run_records_provider_latency_tokens_and_prompt_pack(client: TestClient, run_scope: dict[str, int]) -> None:
    created = client.post(
        "/api/model-runs",
        json={
            "workspace_id": run_scope["workspace_id"],
            "book_id": run_scope["book_id"],
            "job_run_id": run_scope["job_run_id"],
            "prompt_pack_id": run_scope["prompt_pack_id"],
            "provider_name": "openai-global",
            "model_name": "gpt-5.5",
            "capability": "llm",
            "latency_ms": 420,
            "token_usage": 180,
            "input_summary": "生成港口谈判场景。",
            "output_summary": "模型返回首稿摘要。",
            "payload": {"resolved_provider": "openai-global"},
        },
    )
    assert created.status_code == 201, created.text
    result = created.json()
    assert result["provider_name"] == "openai-global"
    assert result["token_usage"] == 180
    assert result["prompt_pack_id"] == run_scope["prompt_pack_id"]

    listing = client.get("/api/model-runs", params={"job_run_id": run_scope["job_run_id"]})
    assert listing.status_code == 200
    assert len(listing.json()) == 1


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
