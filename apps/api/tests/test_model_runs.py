from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
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


def test_runs_job_run_endpoint_reads_persisted_job_run(client: TestClient, run_scope: dict[str, int]) -> None:
    response = client.get(f"/api/model-runs/job-runs/{run_scope['job_run_id']}")

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["id"] == run_scope["job_run_id"]
    assert result["job_type"] == "generation_runtime"
    assert result["status"] == "running"
    assert result["progress"] == {}
    assert result["error_message"] is None


def test_runs_job_run_endpoint_exposes_checkpoint_from_progress(
    client: TestClient, session_factory: sessionmaker[Session], run_scope: dict[str, int]
) -> None:
    with session_factory() as session:
        job = session.get(JobRun, run_scope["job_run_id"])
        assert job is not None
        job.progress = {
            "thread_id": "phase6-runs-thread",
            "current_node": "draft_writer",
            "approval_status": "pending",
        }
        session.commit()

    response = client.get(f"/api/model-runs/job-runs/{run_scope['job_run_id']}")

    assert response.status_code == 200, response.text
    assert response.json()["checkpoint"] == {
        "thread_id": "phase6-runs-thread",
        "current_node": "draft_writer",
        "approval_status": "pending",
    }


def test_runs_job_run_endpoint_includes_model_run_summaries(
    client: TestClient, session_factory: sessionmaker[Session], run_scope: dict[str, int]
) -> None:
    from app.domains.model_runs.service import record_failed_runtime_model_run, record_runtime_model_run

    with session_factory() as session:
        record_runtime_model_run(
            session,
            job_run_id=run_scope["job_run_id"],
            provider_name="mock-provider",
            model_name="storyforge-writer",
            capability="llm",
            latency_ms=160,
            token_usage=42,
            input_summary="生成输入摘要",
            output_summary="生成输出摘要",
        )
        record_failed_runtime_model_run(
            session,
            job_run_id=run_scope["job_run_id"],
            provider_name="mock-provider",
            model_name="storyforge-retry",
            capability="llm",
            input_summary="重试输入摘要",
            error_message="provider timeout",
        )

    response = client.get(f"/api/model-runs/job-runs/{run_scope['job_run_id']}")

    assert response.status_code == 200, response.text
    model_runs = response.json()["model_runs"]
    assert [item["status"] for item in model_runs] == ["completed", "failed"]
    assert model_runs[0]["provider_name"] == "mock-provider"
    assert model_runs[0]["model_name"] == "storyforge-writer"
    assert model_runs[0]["token_usage"] == 42
    assert model_runs[1]["error_message"] == "provider timeout"


def test_retry_runs_job_run_creates_recovery_job_from_failed_checkpoint(
    client: TestClient, session_factory: sessionmaker[Session], run_scope: dict[str, int]
) -> None:
    with session_factory() as session:
        job = session.get(JobRun, run_scope["job_run_id"])
        assert job is not None
        job.status = "failed"
        job.error_message = "provider timeout"
        job.progress = {
            "thread_id": "retry-thread",
            "current_node": "repair_writer",
            "approval_status": "failed",
            "model_run_id": 801,
        }
        session.commit()

    response = client.post(f"/api/model-runs/job-runs/{run_scope['job_run_id']}/retry")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["can_retry"] is True
    assert payload["source_job_run_id"] == run_scope["job_run_id"]
    assert payload["recovery_node"] == "repair_writer"
    assert payload["checkpoint"]["thread_id"] == "retry-thread"
    assert payload["retry_status"] == "queued"
    assert payload["unavailable_reason"] is None

    with session_factory() as session:
        retry_job = session.get(JobRun, payload["retry_job_run_id"])
        assert retry_job is not None
        assert retry_job.status == "queued"
        assert retry_job.progress["retry_of_job_run_id"] == run_scope["job_run_id"]
        assert retry_job.progress["recovery_node"] == "repair_writer"


def test_retry_runs_job_run_rejects_running_job_without_creating_retry(
    client: TestClient, session_factory: sessionmaker[Session], run_scope: dict[str, int]
) -> None:
    response = client.post(f"/api/model-runs/job-runs/{run_scope['job_run_id']}/retry")

    assert response.status_code == 200, response.text
    assert response.json()["can_retry"] is False
    assert response.json()["retry_job_run_id"] is None
    assert response.json()["unavailable_reason"] == "任务尚未失败，不能创建失败重试。"

    with session_factory() as session:
        jobs = session.scalars(select(JobRun)).all()
        assert len(jobs) == 1


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


def test_record_workflow_model_run_payload_persists_completed_adapter_payload(
    session_factory: sessionmaker[Session], run_scope: dict[str, int]
) -> None:
    """workflow adapter 的成功 payload 应写入 API ModelRun 真表。"""

    from app.domains.model_runs.service import list_model_runs, record_workflow_model_run_payload

    api_payload = {
        "job_run_id": run_scope["job_run_id"],
        "provider_name": "mock-provider",
        "model_name": "storyforge-writer",
        "capability": "llm",
        "status": "completed",
        "latency_ms": 160,
        "token_usage": 42,
        "input_summary": "生成输入摘要",
        "output_summary": "生成输出摘要",
        "error_message": None,
        "payload": {"thread_id": "adapter-success-thread", "runtime_job_run_id": "runtime-job-string"},
    }

    with session_factory() as session:
        model_run = record_workflow_model_run_payload(session, api_payload)
        listed = list_model_runs(session, job_run_id=run_scope["job_run_id"])

    assert model_run.status == "completed"
    assert model_run.job_run_id == run_scope["job_run_id"]
    assert model_run.token_usage == 42
    assert model_run.payload["runtime_job_run_id"] == "runtime-job-string"
    assert [item.id for item in listed] == [model_run.id]


def test_record_workflow_model_run_payload_persists_failed_adapter_payload(
    session_factory: sessionmaker[Session], run_scope: dict[str, int]
) -> None:
    """workflow adapter 的失败 payload 应写入 API ModelRun 真表并保留错误。"""

    from app.domains.model_runs.service import list_model_runs, record_workflow_model_run_payload

    api_payload = {
        "job_run_id": run_scope["job_run_id"],
        "provider_name": "mock-provider",
        "model_name": "storyforge-writer",
        "capability": "llm",
        "status": "failed",
        "latency_ms": 0,
        "token_usage": 0,
        "input_summary": "失败输入摘要",
        "output_summary": "",
        "error_message": "provider timeout",
        "payload": {"thread_id": "adapter-failure-thread", "runtime_job_run_id": "runtime-job-string"},
    }

    with session_factory() as session:
        model_run = record_workflow_model_run_payload(session, api_payload)
        listed = list_model_runs(session, job_run_id=run_scope["job_run_id"])

    assert model_run.status == "failed"
    assert model_run.job_run_id == run_scope["job_run_id"]
    assert model_run.token_usage == 0
    assert model_run.error_message == "provider timeout"
    assert model_run.payload["thread_id"] == "adapter-failure-thread"
    assert [item.id for item in listed] == [model_run.id]


def test_record_workflow_model_run_payload_rejects_runtime_string_job_run_id(session: Session) -> None:
    """API helper 必须拒绝把 workflow 字符串任务 ID 当作 JobRun.id。"""

    from app.domains.model_runs.service import ModelRunError, record_workflow_model_run_payload

    with pytest.raises(ModelRunError, match="正整数 ID"):
        record_workflow_model_run_payload(
            session,
            {
                "job_run_id": "runtime-job-string",
                "provider_name": "mock-provider",
                "model_name": "storyforge-writer",
                "capability": "llm",
                "status": "completed",
                "latency_ms": 1,
                "token_usage": 1,
                "input_summary": "输入摘要",
                "output_summary": "输出摘要",
                "payload": {"runtime_job_run_id": "runtime-job-string"},
            },
        )
