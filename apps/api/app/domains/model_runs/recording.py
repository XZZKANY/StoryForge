from __future__ import annotations

from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.common.redaction import redact_sensitive, redact_sensitive_text
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book, Chapter, Scene
from app.domains.jobs.models import JobRun
from app.domains.model_runs.models import ModelRun
from app.domains.model_runs.schemas import ModelRunCreate
from app.domains.prompt_packs.models import PromptPack
from app.domains.workspaces.models import Workspace


class ModelRunError(InputError):
    """模型运行日志引用对象不存在或作用域不一致。"""


def create_model_run(session: Session, payload: ModelRunCreate) -> ModelRun:
    _validate_references(session, payload)
    run_data = payload.model_dump()
    for key in ("input_summary", "output_summary", "error_message"):
        value = run_data.get(key)
        if isinstance(value, str):
            run_data[key] = redact_sensitive_text(value)
    run_data["payload"] = redact_sensitive(run_data.get("payload", {}))
    model_run = ModelRun(**run_data)
    session.add(model_run)
    session.commit()
    session.refresh(model_run)
    return model_run


def record_runtime_model_run(
    session: Session,
    *,
    job_run_id: int,
    provider_name: str,
    model_name: str,
    capability: str,
    latency_ms: int,
    token_usage: int,
    input_summary: str,
    output_summary: str,
    workspace_id: int | None = None,
    book_id: int | None = None,
    scene_id: int | None = None,
    book_run_id: int | None = None,
    chapter_id: int | None = None,
    prompt_pack_id: int | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_estimate: float = 0.0,
    finish_reason: str | None = None,
    retry_count: int = 0,
    repair_count: int = 0,
    prompt_template_version: str | None = None,
    prompt_hash: str | None = None,
    payload: dict | None = None,
) -> ModelRun:
    return create_model_run(
        session,
        ModelRunCreate(
            workspace_id=workspace_id,
            book_id=book_id,
            book_run_id=book_run_id,
            chapter_id=chapter_id,
            scene_id=scene_id,
            job_run_id=job_run_id,
            prompt_pack_id=prompt_pack_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            status="completed",
            latency_ms=latency_ms,
            token_usage=token_usage,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_estimate=cost_estimate,
            finish_reason=finish_reason,
            retry_count=retry_count,
            repair_count=repair_count,
            prompt_template_version=prompt_template_version,
            prompt_hash=prompt_hash,
            input_summary=input_summary,
            output_summary=output_summary,
            payload=payload or {},
        ),
    )


def record_failed_runtime_model_run(
    session: Session,
    *,
    job_run_id: int,
    provider_name: str,
    model_name: str,
    capability: str,
    input_summary: str,
    error_message: str,
    workspace_id: int | None = None,
    book_id: int | None = None,
    scene_id: int | None = None,
    book_run_id: int | None = None,
    chapter_id: int | None = None,
    prompt_pack_id: int | None = None,
    error_kind: str | None = None,
    retry_count: int = 0,
    repair_count: int = 0,
    prompt_template_version: str | None = None,
    prompt_hash: str | None = None,
    payload: dict | None = None,
) -> ModelRun:
    return create_model_run(
        session,
        ModelRunCreate(
            workspace_id=workspace_id,
            book_id=book_id,
            book_run_id=book_run_id,
            chapter_id=chapter_id,
            scene_id=scene_id,
            job_run_id=job_run_id,
            prompt_pack_id=prompt_pack_id,
            provider_name=provider_name,
            model_name=model_name,
            capability=capability,
            status="failed",
            latency_ms=0,
            token_usage=0,
            error_kind=error_kind,
            retry_count=retry_count,
            repair_count=repair_count,
            prompt_template_version=prompt_template_version,
            prompt_hash=prompt_hash,
            input_summary=input_summary,
            output_summary=None,
            error_message=error_message,
            payload=payload or {},
        ),
    )


def _validate_references(session: Session, payload: ModelRunCreate) -> None:
    if payload.workspace_id is not None and session.get(Workspace, payload.workspace_id) is None:
        raise ModelRunError("工作区不存在，无法记录模型运行日志。")
    if payload.book_id is not None and session.get(Book, payload.book_id) is None:
        raise ModelRunError("作品不存在，无法记录模型运行日志。")
    if payload.book_run_id is not None and session.get(BookRun, payload.book_run_id) is None:
        raise ModelRunError("BookRun 不存在，无法记录模型运行日志。")
    if payload.chapter_id is not None and session.get(Chapter, payload.chapter_id) is None:
        raise ModelRunError("章节不存在，无法记录模型运行日志。")
    if payload.scene_id is not None and session.get(Scene, payload.scene_id) is None:
        raise ModelRunError("场景不存在，无法记录模型运行日志。")
    if payload.job_run_id is not None and session.get(JobRun, payload.job_run_id) is None:
        raise ModelRunError("任务不存在，无法记录模型运行日志。")
    if payload.prompt_pack_id is not None and session.get(PromptPack, payload.prompt_pack_id) is None:
        raise ModelRunError("Prompt Pack 不存在，无法记录模型运行日志。")
